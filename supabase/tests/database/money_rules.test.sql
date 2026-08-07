-- Pass 4: the three money rules that were each got WRONG in production and
-- fixed by migration, so each test here is a regression guard with a real
-- incident behind it:
--   * migration 0139 -- margin was divided by a per-PIECE price nobody is
--     charged. Wrong on 21 of 29 SKUs, in both directions.
--   * migrations 0123 / 0126 / 0130 -- date buckets used the database's UTC
--     instead of Maldives time, so a late-evening sale landed on the wrong
--     calendar day (and near month-end, the wrong month). Fixed three times
--     because it kept being missed in one more function.
--   * migration 0124 -- returns were not netted off what an order still owes.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000030', 'test-money@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000030';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000030', true);

-- ── Margin must use the unit actually sold (migration 0139) ───────────────
-- The SKU sells in packs. It carries BOTH a pack price (MVR 700 -- the real
-- one) and a per-piece price (MVR 30 -- an internal figure nobody is ever
-- charged). Landed cost is MVR 14/piece.
--   Correct:  1 - 14 / (700/34) = 32.0%
--   The 0139 bug: 1 - 14 / 30    = 53.3%
-- The two are far enough apart that this test cannot pass by accident.
update skus
   set fixed_price_per_pack_mvr = 700,
       fixed_selling_price_mvr  = 30,
       sellable_units           = array['pack','carton']
 where id = '00000000-0000-0000-0000-000000000005';

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000031', 'TEST-MONEY', '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                             fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000031',
        '00000000-0000-0000-0000-000000000005', 4, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                qty_cartons_received, qty_pieces_received,
                                landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000032',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        '2026-01-01 00:00:00+00', 4, 408, 14.0000, 476.0000, 1428.0000);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 408, 'shipment');

select is(
  (select actual_margin_pct from v_skus where id = '00000000-0000-0000-0000-000000000005'),
  32.0::numeric,
  'margin is measured against the PACK price actually charged (32.0%), not the per-piece price nobody pays (which would read 53.3%)'
);

-- ── Date buckets are Maldives time, not the database''s UTC ────────────────
-- 2026-03-10 20:00 UTC is 2026-03-11 01:00 in Male. It is a sale made in the
-- small hours of the 11th, and every report must say so.
insert into sales_orders (id, order_number, status, channel, source_godown_id, created_at)
values ('00000000-0000-0000-0000-000000000034', 'SO-TEST-TZ', 'confirmed', 'walkin',
        '00000000-0000-0000-0000-000000000006', '2026-03-10 20:00:00+00');
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000005',
        'pack', 1, 34, 700, 700);

select is(
  (select revenue_mvr from get_pnl('2026-03-11', '2026-03-11')),
  700::numeric,
  'a 20:00 UTC sale counts on 11 March -- the Maldives calendar day it was actually made'
);

select is(
  (select revenue_mvr from get_pnl('2026-03-10', '2026-03-10')),
  0::numeric,
  'and it does NOT count on 10 March, which is what the UTC bug used to report'
);

-- ── Returns net off what the order still owes (migration 0124) ────────────
-- MVR 700 order, MVR 700 paid, then MVR 200 returned: the customer is owed
-- 200 back, so the balance must go negative, not sit at zero.
insert into order_payments (order_id, amount_mvr, method, created_by)
values ('00000000-0000-0000-0000-000000000034', 700, 'cash', '00000000-0000-0000-0000-000000000030');

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-000000000034'),
  0::numeric,
  'a fully paid order shows a zero balance before any return'
);

insert into sales_returns (order_id, sku_id, godown_id, qty_pieces, refund_amount_mvr,
                            restocked, reason, settlement, created_by)
values ('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 10, 200, true, 'defective', 'refund',
        '00000000-0000-0000-0000-000000000030');

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-000000000034'),
  -200::numeric,
  'the return is netted off the balance -- without it the order would wrongly read as settled'
);

-- ── The catalogue offers only units the SKU actually sells ────────────────
-- Standing rule: no SKU sells loose pieces. A screen that offers a "piece"
-- tier is offering something the business does not do.
select is_empty(
  $$select internal_code from skus where 'piece' = any(sellable_units)$$,
  'no SKU is sellable by the piece -- packs and cartons only'
);

select is(
  (select count(*) from sales_order_lines sol
     join skus s on s.id = sol.sku_id
    where sol.uom = 'piece' and not ('piece' = any(s.sellable_units))),
  0::bigint,
  'no sale line is recorded in a unit its SKU does not sell'
);

-- ── Debt ages on the Maldives calendar too (migration 0152) ───────────────
-- get_receivables_aging was the FOURTH instance of the UTC-date bug class:
-- it aged every debt with `CURRENT_DATE - so.created_at::date`, both sides in
-- the server's UTC day. Malé is UTC+5, so anything sold after 19:00 UTC is
-- already tomorrow there, and a debt could read a day older or younger than
-- it is — enough to flip the 30- and 60-day buckets that decide whether Ali
-- is told to chase it.
--
-- Two debts, TWO HOURS apart, straddling midnight in Malé:
--   18:00 UTC = 23:00 on the 10th  -> Maldives day 10
--   20:00 UTC = 01:00 on the 11th  -> Maldives day 11
-- Correct behaviour: different days, so their ages differ by exactly 1.
-- The UTC bug: both fall on the 10th, so the ages are identical and the
-- difference collapses to 0.
--
-- The two rows are compared against EACH OTHER rather than against a
-- wall-clock expectation, and that is deliberate. The first version of this
-- test asserted one order's age against `Maldives today - 11 March`, and it
-- passed even with the bug reinstated: shifting the debt a day earlier and
-- reading "today" a day earlier cancel exactly, so for the five hours a day
-- when UTC and Malé disagree the check was blind. Comparing two rows
-- computed in the same instant removes the clock from the assertion.
insert into customers (id, name, phone, price_tier)
values ('00000000-0000-0000-0000-000000000036', 'Late Night', '7100001', 'retail'),
       ('00000000-0000-0000-0000-000000000037', 'After Midnight', '7100002', 'retail');

insert into sales_orders (id, order_number, status, payment_status, channel,
                          customer_id, source_godown_id, created_at)
values ('00000000-0000-0000-0000-000000000038', 'SO-TEST-AGE-10', 'confirmed', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000036',
        '00000000-0000-0000-0000-000000000006', '2026-03-10 18:00:00+00'),
       ('00000000-0000-0000-0000-000000000039', 'SO-TEST-AGE-11', 'confirmed', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000037',
        '00000000-0000-0000-0000-000000000006', '2026-03-10 20:00:00+00');
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-000000000005',
        'pack', 1, 34, 700, 700),
       ('00000000-0000-0000-0000-000000000039', '00000000-0000-0000-0000-000000000005',
        'pack', 1, 34, 700, 700);

select is(
  (select a.oldest_days - b.oldest_days
     from get_receivables_aging() a, get_receivables_aging() b
    where a.customer_name = 'Late Night' and b.customer_name = 'After Midnight'),
  1,
  'two debts two hours apart across Male midnight age one day apart -- under the UTC bug both land on the 10th and this reads 0'
);

-- ── The whole bug class, not just this instance ───────────────────────────
-- Fixed five separate times now (0123, 0126, 0130, 0152, 0153), each sweep
-- leaving one more behind. The class has TWO shapes and lives in TWO kinds
-- of object, and every previous guard covered only part of that grid:
--
--   shape 1  CURRENT_DATE              -- the server's UTC day
--   shape 2  <timestamptz col>::date   -- buckets an instant on the UTC day
--   place 1  functions
--   place 2  VIEWS  <- 0152's guard never looked here, and v_expiring_stock
--                     was sitting in it
--
-- The column list is every genuine `timestamp with time zone` column in the
-- schema. It deliberately does NOT include date columns like expense_date or
-- start_date: those have no timezone to get wrong, and matching them would
-- make this fail on correct code.
--
-- If something new needs "today", it is (now() at time zone
-- 'Indian/Maldives')::date. There is no correct use of the server's day in
-- this database.
select is_empty(
  $$with src as (
      select 'function ' || p.proname as obj, p.prosrc as body
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
      union all
      select 'view ' || c.relname, pg_get_viewdef(c.oid, true)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v','m')
    )
    select obj from src
     where body ~ '\y(\w+)\.(created_at|updated_at|received_at|paid_at|delivered_at|dispatched_at|picked_at|cash_deposited_at|arrived_at|grn_confirmed_at|ordered_at|verified_at|last_paid_at)::date'
        or body ~* '\yCURRENT_DATE\y'$$,
  'no function OR view anywhere buckets a timestamp on the server''s UTC day -- Maldives time, everywhere, permanently'
);

select * from finish();
rollback;

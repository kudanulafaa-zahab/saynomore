-- Comparing any two arrivals — migration 0218.
--
-- Ali, 2026-08-29:
--   *"What I want is to select any shipments I have ordered to compare prices
--    between them as well as competitor pricing to set a current selling
--    price."*
--
-- What these tests defend:
--
--  A. THE DEFAULT IS NOT ALWAYS THE ANSWER. "The arrival before" is per-SKU
--     and picks up direct receipts, which is right on an ordinary day and
--     wrong when he wants container against container. In his real data five
--     products came in on a direct receipt five days before SH-2026-002, so
--     the automatic comparison for those five is a local top-up and he could
--     not reach SH-2026-001 at all. Both behaviours must work, and the
--     explicit one must win when it is asked for.
--
--  B. THE TWO ARGUMENTS ARE NOT ORDERED BY THE CALLER. Landed cost is a
--     property of an arrival, and pricing off the older of two arrivals prices
--     stock to replace itself at a cost that no longer exists. So the function
--     sorts them: the later arrival is always what the money is computed from.
--     Passed either way round, the answer must be IDENTICAL — this is what
--     makes two menus safe to put on a phone.
--
--  C. ABSENT IS NOT NEW. A product that was not on the shipment he chose to
--     compare against must say so, not report `first_arrival`, which reads as
--     "this product is new" and is a different, untrue statement.
--
--  D. The menus offer received shipments only. A shipment still on the water
--     has no landed cost, so there is nothing on it to compare or price from.
--
--  E. Both functions are closed to anon, in the migration that created them.

begin;
select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000006a0', 'test-arrivals@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000006a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a0', true);

-- THREE arrivals, which is the whole point: two containers with a direct
-- receipt sitting between them. With only two, the default and the explicit
-- comparison give the same answer and neither A nor B can fail.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr, status, grn_confirmed_at)
values ('00000000-0000-0000-0000-0000000006a1', 'SH-ARR-OLD', '00000000-0000-0000-0000-000000000007',
        20.5, 16000, 'grn_confirmed', now() - interval '50 days'),
       ('00000000-0000-0000-0000-0000000006a2', 'SH-ARR-NEW', '00000000-0000-0000-0000-000000000007',
        21.5, 16000, 'grn_confirmed', now() - interval '1 day'),
       -- Still on the water. Must never appear in the menus.
       ('00000000-0000-0000-0000-0000000006a3', 'SH-ARR-AFLOAT', '00000000-0000-0000-0000-000000000007',
        21.5, 16000, 'in_transit', null);

create function pg_temp.land(p_ship uuid, p_sku uuid, p_line uuid, p_batch uuid,
                             p_landed numeric, p_pieces integer, p_when timestamptz)
returns void language plpgsql as $$
declare
  v_pp integer; v_ppc integer;
begin
  select pcs_per_pack, packs_per_carton into v_pp, v_ppc from skus where id = p_sku;
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (p_line, p_ship, p_sku, 1, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received, landed_per_piece_mvr,
                                 landed_per_pack_mvr, landed_per_carton_mvr)
  values (p_batch, p_line, p_sku, '00000000-0000-0000-0000-000000000006', p_when,
          1, p_pieces, p_landed, p_landed * v_pp, p_landed * v_pp * v_ppc);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (p_batch, p_sku, '00000000-0000-0000-0000-000000000006', 'in', p_pieces, 'shipment');
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- The product with all three arrivals.
--   SH-ARR-OLD    50 days ago   MVR 10.00 a piece → 100 a pack
--   direct receipt 10 days ago  MVR 11.00 a piece → 110 a pack
--   SH-ARR-NEW     1 day  ago   MVR 12.50 a piece → 125 a pack
-- Price is fixed at MVR 200 a pack, so the margin absorbs every rise.
-- ══════════════════════════════════════════════════════════════════════════
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000006b0', '00000000-0000-0000-0000-000000000004',
        'TEST-ARRIVALS-BOTH-10x2', 10, 2, 40, 30, 30, 200, 400, array['pack','carton']);

select pg_temp.land('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006b0',
                    '00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006b2',
                    10, 20, now() - interval '50 days');

-- The direct receipt: stock that landed with no shipment line behind it.
-- `source` must say 'direct' — inventory_batches_source_link_chk ties the two
-- together, so a batch with no shipment line and source 'shipment' is refused.
-- That constraint is the ledger doing its job; the batch is genuinely a
-- different kind of arrival, which is the whole reason this test exists.
insert into inventory_batches (id, sku_id, godown_id, received_at, source,
                               qty_cartons_received, qty_pieces_received, landed_per_piece_mvr,
                               landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000006b5', '00000000-0000-0000-0000-0000000006b0',
        '00000000-0000-0000-0000-000000000006', now() - interval '10 days', 'direct',
        1, 20, 11, 110, 220);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000006b5', '00000000-0000-0000-0000-0000000006b0',
        '00000000-0000-0000-0000-000000000006', 'in', 20, 'direct_receipt');

select pg_temp.land('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-0000000006b0',
                    '00000000-0000-0000-0000-0000000006b3', '00000000-0000-0000-0000-0000000006b4',
                    12.5, 20, now() - interval '1 day');

-- A product that ONLY rode the new container. Nothing to compare it with on
-- SH-ARR-OLD, which is a different fact from never having arrived.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000006c0', '00000000-0000-0000-0000-000000000004',
        'TEST-ARRIVALS-NEWONLY-10x2', 10, 2, 40, 30, 30, 200, 400, array['pack','carton']);
select pg_temp.land('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-0000000006c0',
                    '00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006c2',
                    12.5, 20, now() - interval '1 day');

-- ══════════════════════════════════════════════════════════════════════════
-- A. The default still walks back one step, direct receipt included
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select prev_reference from get_price_review('00000000-0000-0000-0000-0000000006a2')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  'Direct receipt',
  'with no comparison chosen the review still walks back exactly one arrival, direct receipt included'
);

select is(
  (select prev_cost_unit from get_price_review('00000000-0000-0000-0000-0000000006a2')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  110.00::numeric,
  'and costs it at that arrival -- MVR 110 a pack, not the container before it'
);

-- ...and choosing the container reaches PAST the direct receipt. This is the
-- capability that did not exist: the comparison Ali actually wanted was
-- unreachable, not merely inconvenient.
select is(
  (select prev_reference from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                               '00000000-0000-0000-0000-0000000006a1')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  'SH-ARR-OLD',
  'choosing a shipment compares against THAT arrival, reaching past the direct receipt'
);

select is(
  (select prev_cost_unit from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                               '00000000-0000-0000-0000-0000000006a1')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  100.00::numeric,
  'at the cost that arrival actually landed at -- MVR 100 a pack'
);

-- The money still comes off the NEWER arrival, whichever comparison is chosen.
-- Restoring 50% from MVR 125 needs MVR 250; from MVR 110 it would need 220,
-- and 220 would be a price set off a cost he can no longer buy at.
select is(
  (select this_cost_unit from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                               '00000000-0000-0000-0000-0000000006a1')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  125.00::numeric,
  'the cost being priced FROM is always the later arrival'
);

select is(
  (select suggested_unit from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                               '00000000-0000-0000-0000-0000000006a1')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  250::numeric,
  'so the suggestion restores the old margin against replacement cost, never against the cheaper history'
);

-- ══════════════════════════════════════════════════════════════════════════
-- B. THE ARGUMENTS ARE NOT ORDERED BY THE CALLER
-- ══════════════════════════════════════════════════════════════════════════
-- This is what makes two menus safe. Hand them over backwards and the function
-- sorts them rather than pricing off the older arrival.
select is(
  (select count(*) from (
     select * from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                    '00000000-0000-0000-0000-0000000006a1')
     except
     select * from get_price_review('00000000-0000-0000-0000-0000000006a1',
                                    '00000000-0000-0000-0000-0000000006a2')
   ) x),
  0::bigint,
  'the two arrivals passed either way round give exactly the same answer'
);

select is(
  (select this_reference from get_price_review('00000000-0000-0000-0000-0000000006a1',
                                               '00000000-0000-0000-0000-0000000006a2')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  'SH-ARR-NEW',
  'and the later arrival is named as the one being priced from, not the one passed first'
);

-- The same arrival on both sides is not a comparison; it must fall back rather
-- than compare a shipment with itself and report no change.
select is(
  (select prev_reference from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                               '00000000-0000-0000-0000-0000000006a2')
    where sku_id = '00000000-0000-0000-0000-0000000006b0'),
  'Direct receipt',
  'one arrival chosen on both sides is not a comparison, so it falls back to the arrival before'
);

-- ══════════════════════════════════════════════════════════════════════════
-- C. ABSENT IS NOT NEW
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select verdict from get_price_review('00000000-0000-0000-0000-0000000006a2',
                                        '00000000-0000-0000-0000-0000000006a1')
    where sku_id = '00000000-0000-0000-0000-0000000006c0'),
  'not_compared',
  'a product absent from the chosen shipment says so, instead of claiming to be a first arrival'
);

-- ══════════════════════════════════════════════════════════════════════════
-- D. The menus offer received shipments only
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select string_agg(reference, ',' order by received_on desc) from get_arrivals()
    where reference like 'SH-ARR-%'),
  'SH-ARR-NEW,SH-ARR-OLD',
  'the menus list received arrivals newest first, and never one still on the water'
);

-- ══════════════════════════════════════════════════════════════════════════
-- E. Closed to anon in the same migration that created them
-- ══════════════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.get_arrivals()', 'execute')
  and not has_function_privilege('anon', 'public.get_price_review(uuid,uuid)', 'execute'),
  'neither function is reachable by anon'
);

select * from finish();
rollback;

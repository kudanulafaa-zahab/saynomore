-- Do not buy it twice: the purchase list counts what is already afloat.
--
-- Found on live data, 2026-08-17. The Reorder screen was telling Ali to buy
-- 49 cartons of goods sitting in a container he had already paid for:
--
--   Xtra Kering XL     buy 10 cartons     13 already on SH-2026-002
--   Xtra Kering L      buy  5 cartons     13 already on SH-2026-002
--   Xtra Kering NB/S   buy  4 cartons     20 already on SH-2026-002
--
-- Freight is charged by volume, so a duplicated carton pays its own CBM twice,
-- and the cash leaves months before the stock can be sold.
--
-- The missing idea has a name: inventory practice reorders against the
-- INVENTORY POSITION — on hand PLUS on order — never against the shelf alone.
--
-- WHAT THIS FILE GUARDS, and why each half matters:
--
--   * incoming stock reduces what he is told to buy       (the money)
--   * it is REPORTED, not just subtracted                 (the trust)
--   * a DRAFT shipment does not count                     (the trap)
--   * a received shipment does not count TWICE            (the other trap)
--   * stock health still answers from the shelf           (the boundary)
--
-- The draft case is the subtle one. A draft shipment is usually the purchase
-- order being built FROM this list, so if drafts counted, entering a line would
-- suppress the suggestion that prompted it and the screen would argue with the
-- person using it.

begin;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a0', 'test-water@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a0', true);

-- A product that sells steadily and is nearly out: 34 pieces a pack, 3 packs a
-- carton (102 a carton, the seeded SKU). Received 200, sold 190 over the last
-- 60 days, so there is real demand and almost nothing left.
do $$
declare b uuid;
begin
  insert into inventory_batches (id, sku_id, godown_id, received_at, qty_cartons_received,
                                 qty_pieces_received, landed_per_piece_mvr, landed_per_pack_mvr,
                                 landed_per_carton_mvr, source)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000005',
          '00000000-0000-0000-0000-000000000006', now() - interval '60 days',
          2, 204, 10, 340, 1020, 'direct') returning id into b;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
  values (b, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
          'in', 204, 'direct_receipt', now() - interval '60 days');
  -- Sold steadily across the window, so daily_avg is real rather than a spike.
  for i in 1..19 loop
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                                 source_type, created_at)
    values (b, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
            'out', 10, 'sales_order', now() - (i || ' days')::interval);
  end loop;
end $$;

-- Baseline: with nothing on order, it wants some.
select cmp_ok(
  (select suggested_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  '>', 0,
  'a fast seller that is nearly out is worth buying when nothing is coming'
);

select is(
  (select incoming_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  0::numeric,
  'and it says plainly that nothing is on the way'
);

-- ── A container is bought and afloat ───────────────────────────────────────
do $$
begin
  insert into shipments (id, reference, supplier_id, status, expected_arrival_date,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values ('00000000-0000-0000-0000-0000000000a2', 'SH-TEST-WATER',
          '00000000-0000-0000-0000-000000000007', 'in_transit',
          (now() at time zone 'Indian/Maldives')::date + 7, 15.4, 15400);
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000005',
          40, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');
end $$;

-- THE MONEY. 40 cartons is 4,080 pieces against a demand of about 10 a day —
-- far more than any cover window needs, so the right answer is now zero.
select is(
  (select suggested_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  0,
  'stock already bought and afloat is not bought again'
);

-- THE TRUST. A number that shrinks for invisible reasons stops being believed,
-- so the reason comes back with it.
select is(
  (select incoming_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  40::numeric,
  'and the list SAYS how much is coming, rather than silently shrinking'
);

select is(
  (select incoming_eta from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  ((now() at time zone 'Indian/Maldives')::date + 7),
  'with the date it is expected, so he can judge whether it arrives in time'
);

-- THE BOUNDARY. Stock health is a different question from what to buy: the
-- shelf is empty today whatever is on the water, and the customer in front of
-- you cannot buy a container. The dashboard's stock-out row reads this.
select cmp_ok(
  (select stock_pieces from get_sku_reorder_alerts()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  '<', 20::numeric,
  'stock health still answers from the shelf, not from the shipping line'
);

select is(
  (select stock_pieces from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  (select stock_pieces from get_sku_reorder_alerts()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  'and the purchase list still reports the real shelf figure beside the advice'
);

-- ── A DRAFT is a plan, not a purchase ──────────────────────────────────────
-- The trap: a draft shipment is usually the order being built from this very
-- list. If it counted, typing a line would delete the reason for typing it.
do $$
begin
  update shipments set status = 'draft' where id = '00000000-0000-0000-0000-0000000000a2';
end $$;

select is(
  (select incoming_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  0::numeric,
  'a DRAFT shipment is not stock on order — it is the order being written'
);

select cmp_ok(
  (select suggested_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  '>', 0,
  'so the suggestion comes back, instead of the list arguing with itself'
);

-- ── A RECEIVED shipment is on the shelf, not on the water ──────────────────
-- Counting it in both places would halve every future suggestion.
do $$
begin
  update shipments set status = 'grn_confirmed', grn_confirmed_at = now()
  where id = '00000000-0000-0000-0000-0000000000a2';
end $$;

select is(
  (select incoming_cartons from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000005'),
  0::numeric,
  'once received, a shipment stops being "on the way" — it is the shelf now'
);

-- ── The defaults are load-bearing ──────────────────────────────────────────
-- Three OUT columns were added, which needs a DROP rather than a REPLACE, and
-- a DROP is how the defaults were lost once before. The screen calls this with
-- no arguments.
select is(
  (select count(*)::int from pg_proc p
    where p.proname = 'get_reorder_suggestions' and p.pronargdefaults = 2),
  1,
  'and it still has both defaults, because the screen calls it with none'
);

select * from finish();
rollback;

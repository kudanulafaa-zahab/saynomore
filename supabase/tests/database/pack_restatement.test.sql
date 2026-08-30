-- A pack size typed wrong is a RESTATEMENT, not a new product.
--
-- Ali, 2026-08-30: *"I made a mistake for xtra kering xxxl… The 34/pk should
-- actually be 32/pk. I can't edit in the sku edit because it says stock already
-- sold. How do I fix this and also how do I fix in future incidents. Do it
-- properly. Not adhoc."*
--
-- ── WHAT THIS SUITE DEFENDS ───────────────────────────────────────────────
--
-- Two things that pull in opposite directions, which is why both need holding:
--
-- 1. THE DOOR IS STILL A WALL. A genuine format change must still be refused,
--    and a plain UPDATE must still be refused. If correct_pack_config's escape
--    ever leaked into ordinary writes, every guard in 0190 would be decorative.
--
-- 2. THE MONEY DOES NOT MOVE WHEN IT SHOULD NOT. Cost per pack is carton cost
--    divided by packs per carton — pcs_per_pack does not appear in it. So
--    correcting only the pack size must leave every figure alone, and the
--    packs and cartons on the shelf must be identical before and after.
--
-- The second is what 0191 got wrong in the other direction, and it is the
-- reason the impact preview exists at all: a one-off migration cannot show
-- anyone what it is about to do.

begin;
select plan(14);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000a10', 'test-restate@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000a10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000a10', true);

-- ── Fixture: 34 x 3 with a receipt and a sale against it ──────────────────
-- Deliberately the real shape of the incident: a carton received, some of it
-- sold by the pack, the rest on the shelf.
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000a20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test Restate Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a20',
        'Restate XXXL', '{"size":"XXXL-restate"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000a22', '00000000-0000-0000-0000-000000000a21',
        'TEST-RESTATE-34x3', 34, 3, 52, 20, 34, 255, array['pack','carton']);

-- One carton in, costing MVR 544.1175 — the money paid, which must never move.
insert into inventory_batches (id, sku_id, godown_id, received_at, source,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a22',
        '00000000-0000-0000-0000-000000000006', now() - interval '20 days', 'direct',
        1, 102, 5.3345, 181.3725, 544.1175);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
values ('00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a22',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'direct_receipt', now() - interval '20 days');

-- Two packs sold at MVR 255 each. Priced PER PACK, which is why revenue cannot
-- move when the piece count does.
insert into sales_orders (id, order_number, status, customer_id, created_at)
values ('00000000-0000-0000-0000-000000000a30', 'SO-RESTATE-1', 'delivered',
        (select id from customers limit 1), now() - interval '5 days');
insert into sales_order_lines (order_id, sku_id, qty, uom, qty_pieces,
                               unit_price_mvr, line_total_mvr, landed_cost_per_piece_mvr)
values ('00000000-0000-0000-0000-000000000a30', '00000000-0000-0000-0000-000000000a22',
        2, 'pack', 68, 255, 510, 5.3345);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                             source_type, source_id, created_at)
values ('00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a22',
        '00000000-0000-0000-0000-000000000006', 'out', 68, 'sales_order',
        '00000000-0000-0000-0000-000000000a30', now() - interval '5 days');

-- ══════════════════════════════════════════════════════════════════════════
-- THE WALL IS STILL A WALL
-- ══════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$update skus set pcs_per_pack = 32 where id = '00000000-0000-0000-0000-000000000a22'$$,
  '23514',
  null,
  'a plain UPDATE of the pack size is still refused once stock has moved through it'
);

select throws_ok(
  $$select correct_pack_config('00000000-0000-0000-0000-000000000a22', 32, 3, 'typo')$$,
  '23514',
  null,
  'and the correction itself refuses a reason too short to be read later'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE PREVIEW TELLS THE TRUTH BEFORE ANYTHING MOVES
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (get_pack_config_change_impact('00000000-0000-0000-0000-000000000a22', 32, 3) ->> 'money_moves')::boolean,
  false,
  'correcting only the pack size is reported as moving no money'
);

select is(
  (get_pack_config_change_impact('00000000-0000-0000-0000-000000000a22', 32, 4) ->> 'money_moves')::boolean,
  true,
  'but changing packs per carton is reported as moving money, because it does'
);

select is(
  (get_pack_config_change_impact('00000000-0000-0000-0000-000000000a22', 32, 3) ->> 'code_after'),
  'TEST-RESTATE-32x3',
  'the code follows the pack config it names'
);

-- Nothing has been written yet: a preview that mutated would be a trap.
select is(
  (select pcs_per_pack from skus where id = '00000000-0000-0000-0000-000000000a22'),
  34,
  'and asking what would happen changes nothing'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE CORRECTION
-- ══════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$select correct_pack_config('00000000-0000-0000-0000-000000000a22', 32, 3,
      'Counted a carton: it holds 3 packs of 32, not 34')$$,
  'an admin can correct a pack size that was typed wrong'
);

select is(
  (select pcs_per_pack || 'x' || packs_per_carton || ' ' || internal_code
     from skus where id = '00000000-0000-0000-0000-000000000a22'),
  '32x3 TEST-RESTATE-32x3',
  'the product and its code both carry the corrected size'
);

-- ── The money. None of it may move. ───────────────────────────────────────
select is(
  (select landed_per_carton_mvr from inventory_batches
    where id = '00000000-0000-0000-0000-000000000a23'),
  544.1175::numeric,
  'the money paid for that carton is untouched — hard rule 3'
);

select is(
  (select round(landed_per_pack_mvr, 4) from inventory_batches
    where id = '00000000-0000-0000-0000-000000000a23'),
  181.3725::numeric,
  'and so is the cost per pack, because packs per carton did not change'
);

select is(
  (select round(sum(qty_pieces * landed_cost_per_piece_mvr), 2) from sales_order_lines
    where sku_id = '00000000-0000-0000-0000-000000000a22'),
  362.75::numeric,
  'cost of that sale is preserved to the cent: quantity and cost/piece scale inversely'
);

select is(
  (select sum(line_total_mvr) from sales_order_lines
    where sku_id = '00000000-0000-0000-0000-000000000a22'),
  510::numeric,
  'and what the customer was charged never enters into it'
);

-- ── The shelf. Same goods, counted correctly. ─────────────────────────────
-- 1 carton in (3 packs), 2 packs out, 1 pack left — before AND after. The
-- piece figure moves from 34 to 32; the pack figure does not move at all.
select is(
  (select sum(stock_signed_delta(movement_type, qty_pieces)) from stock_movements
    where sku_id = '00000000-0000-0000-0000-000000000a22'),
  32::bigint,
  'one pack is still one pack, now counted as 32 rather than 34'
);

select is(
  (select source_type from stock_movements
    where sku_id = '00000000-0000-0000-0000-000000000a22' and source_type = 'pack_restatement'),
  'pack_restatement',
  'and the correcting entry is a restatement, never mistaken for shrinkage'
);

select * from finish();
rollback;

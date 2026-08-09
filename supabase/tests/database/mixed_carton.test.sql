-- Pass 15: a carton cannot be sold as a fraction of a carton.
-- Regression guard for migration 0163.
--
-- Ali, 2026-08-09, with a screenshot of a New Sale cart reading
-- "1.6666666666666667 cartons in cart".
--
-- The mixed-carton sheet REPLACED a colour's line instead of adding to it, so
-- building 2 Purple + 4 Red and then 6 Purple left 6 Purple + 4 Red = 10
-- bottles. Four bottles the salesperson entered vanished, and the order held
-- one and two-thirds of a carton -- a quantity that cannot be sold.
--
-- Nothing refused it. create_and_post_sale checks each line's uom, quantity and
-- price, but has no view of whether the lines TOGETHER make whole cartons; and
-- 0156's whole-selling-unit guard does not help, because for a piece line every
-- integer is a whole piece.
--
-- The invariant is about the whole ORDER -- a mixed carton is spread across one
-- line per colour, and 3 Red is fine beside 3 Blue and wrong on its own -- so
-- it is a DEFERRED CONSTRAINT TRIGGER that runs once at COMMIT. That covers
-- every write path rather than the one that happened to have the bug.

begin;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000001c0', 'test-ctn@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000001c0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000001c0', true);

-- ── A mixed-carton brand: bottles, 6 to a carton, carton-only ─────────────
insert into brands (id, name, mixed_carton_pieces)
values ('00000000-0000-0000-0000-0000000001c1', 'Testsoft', 6);
-- Categories are global (no brand_id). unit_uom 'ml' is what makes the guard
-- say "bottles" rather than "pieces", so it is part of what is under test.
insert into product_categories (id, name, unit_uom, cost_basis)
values ('00000000-0000-0000-0000-0000000001c2', 'Test Handwash', 'ml', 'per_100ml');
insert into product_models (id, category_id, brand_id, name)
values ('00000000-0000-0000-0000-0000000001c3', '00000000-0000-0000-0000-0000000001c2',
        '00000000-0000-0000-0000-0000000001c1', 'Blue');
insert into product_models (id, category_id, brand_id, name)
values ('00000000-0000-0000-0000-0000000001c4', '00000000-0000-0000-0000-0000000001c2',
        '00000000-0000-0000-0000-0000000001c1', 'Red');
insert into variants (id, model_id, display_name)
values ('00000000-0000-0000-0000-0000000001c5', '00000000-0000-0000-0000-0000000001c3', 'Rose 700ml'),
       ('00000000-0000-0000-0000-0000000001c6', '00000000-0000-0000-0000-0000000001c4', 'Sakura 700ml');

insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000001c7', '00000000-0000-0000-0000-0000000001c5',
        'TESTSOFT-BLUE-1x6', 1, 6, 40, 30, 30, 220, array['carton']),
       ('00000000-0000-0000-0000-0000000001c8', '00000000-0000-0000-0000-0000000001c6',
        'TESTSOFT-RED-1x6', 1, 6, 40, 30, 30, 220, array['carton']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000001c9', 'SH-TEST-CTN',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

create function pg_temp.stock_it(p_sku uuid, p_line uuid, p_batch uuid, p_pieces integer)
returns void language plpgsql as $$
begin
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (p_line, '00000000-0000-0000-0000-0000000001c9', p_sku, p_pieces / 6, 0.036, 10, 'USD',
          '00000000-0000-0000-0000-000000000006');
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received, landed_per_piece_mvr,
                                 landed_per_pack_mvr, landed_per_carton_mvr)
  values (p_batch, p_line, p_sku, '00000000-0000-0000-0000-000000000006',
          now() - interval '3 days', p_pieces / 6, p_pieces, 20, 20, 120);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (p_batch, p_sku, '00000000-0000-0000-0000-000000000006', 'in', p_pieces, 'shipment');
end $$;

select pg_temp.stock_it('00000000-0000-0000-0000-0000000001c7',
                        '00000000-0000-0000-0000-0000000001d0',
                        '00000000-0000-0000-0000-0000000001d1', 120);
select pg_temp.stock_it('00000000-0000-0000-0000-0000000001c8',
                        '00000000-0000-0000-0000-0000000001d2',
                        '00000000-0000-0000-0000-0000000001d3', 120);

-- The trigger is DEFERRABLE INITIALLY DEFERRED, which is what makes it correct
-- in production: create_and_post_sale inserts a mixed carton one colour at a
-- time, so an immediate check would fail on the first line every time. It
-- therefore only fires at COMMIT -- and a pgTAP test never commits, it rolls
-- back. SET CONSTRAINTS ... IMMEDIATE forces the pending check to run right
-- here instead, then hands the deferral back.
create function pg_temp.flush() returns void language plpgsql as $$
begin
  set constraints trg_assert_whole_mixed_cartons immediate;
  set constraints trg_assert_whole_mixed_cartons deferred;
end $$;

-- Build an order from line specs, exactly as create_and_post_sale would.
create function pg_temp.mk_order(p_order uuid, p_num text, p_lines jsonb)
returns void language plpgsql as $$
declare v_l jsonb; v_sku skus%rowtype; v_per int; v_pieces int;
begin
  insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
  values (p_order, p_num, 'draft', 'pending', 'walkin', '00000000-0000-0000-0000-000000000006');
  for v_l in select * from jsonb_array_elements(p_lines) loop
    select * into v_sku from skus where id = (v_l->>'sku')::uuid;
    v_per := case v_l->>'uom' when 'carton' then v_sku.pcs_per_pack * v_sku.packs_per_carton
                              when 'pack'   then v_sku.pcs_per_pack else 1 end;
    v_pieces := (v_l->>'qty')::int * v_per;
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                                   unit_price_mvr, line_total_mvr, is_mixed_carton_fill)
    values (p_order, (v_l->>'sku')::uuid, v_l->>'uom', (v_l->>'qty')::numeric, v_pieces,
            (v_l->>'price')::numeric,
            round((v_l->>'qty')::numeric * (v_l->>'price')::numeric, 2),
            coalesce((v_l->>'mixed')::boolean, false));
  end loop;
  perform pg_temp.flush();
end $$;

-- Mutations get the same treatment, each on its own order so one failure
-- cannot leave a broken order behind for the next test to trip over.
create function pg_temp.del_line(p_order uuid, p_sku uuid)
returns void language plpgsql as $$
begin
  delete from sales_order_lines where order_id = p_order and sku_id = p_sku;
  perform pg_temp.flush();
end $$;

create function pg_temp.set_qty(p_order uuid, p_sku uuid, p_qty integer)
returns void language plpgsql as $$
begin
  update sales_order_lines set qty = p_qty, qty_pieces = p_qty,
         line_total_mvr = round(p_qty * unit_price_mvr, 2)
   where order_id = p_order and sku_id = p_sku;
  perform pg_temp.flush();
end $$;

-- ── 1. ONE mixed carton across two colours ────────────────────────────────
select lives_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e0', 'SO-CTN-1',
      '[{"sku":"00000000-0000-0000-0000-0000000001c7","uom":"piece","qty":2,"price":36.67,"mixed":true},
        {"sku":"00000000-0000-0000-0000-0000000001c8","uom":"piece","qty":4,"price":36.67,"mixed":true}]'::jsonb)$$,
  '2 Blue + 4 Red is one full carton and saves'
);

-- ── 2. TWO mixed cartons — "any quantity of cartons" ──────────────────────
select lives_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e1', 'SO-CTN-2',
      '[{"sku":"00000000-0000-0000-0000-0000000001c7","uom":"piece","qty":5,"price":36.67,"mixed":true},
        {"sku":"00000000-0000-0000-0000-0000000001c8","uom":"piece","qty":7,"price":36.67,"mixed":true}]'::jsonb)$$,
  '5 Blue + 7 Red is TWO full cartons and saves -- the sheet used to cap at one'
);

-- ── 3. THE BUG: 10 bottles, one and two-thirds of a carton ────────────────
select throws_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e2', 'SO-CTN-3',
      '[{"sku":"00000000-0000-0000-0000-0000000001c7","uom":"piece","qty":6,"price":36.67,"mixed":true},
        {"sku":"00000000-0000-0000-0000-0000000001c8","uom":"piece","qty":4,"price":36.67,"mixed":true}]'::jsonb)$$,
  '23514',
  null,
  'the exact 6 Blue + 4 Red = 10 bottles Ali screenshotted is REFUSED'
);

-- ── 4. A single-colour carton is an ordinary carton sale ──────────────────
select lives_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e3', 'SO-CTN-4',
      '[{"sku":"00000000-0000-0000-0000-0000000001c7","uom":"carton","qty":3,"price":220}]'::jsonb)$$,
  'three single-colour cartons save as a plain carton line -- no mixed flag needed'
);

select is(
  (select uom from sales_order_lines where order_id = '00000000-0000-0000-0000-0000000001e3'),
  'carton',
  'and the unit stored is the carton, which is what he sells'
);

select is(
  (select qty_pieces from sales_order_lines where order_id = '00000000-0000-0000-0000-0000000001e3'),
  18,
  'three cartons of six bottles is eighteen bottles of stock'
);

-- ── 5. Single colour AND a mix, same order ────────────────────────────────
select lives_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e4', 'SO-CTN-5',
      '[{"sku":"00000000-0000-0000-0000-0000000001c7","uom":"carton","qty":2,"price":220},
        {"sku":"00000000-0000-0000-0000-0000000001c8","uom":"piece","qty":6,"price":36.67,"mixed":true}]'::jsonb)$$,
  'two Blue cartons plus a full mixed carton of Red is a valid order'
);

-- ── 6. Removing a colour must not leave a part-carton behind ──────────────
select throws_ok(
  $$select pg_temp.del_line('00000000-0000-0000-0000-0000000001e0',
                            '00000000-0000-0000-0000-0000000001c7')$$,
  '23514',
  null,
  'deleting one colour out of a mixed carton leaves 4 bottles and is refused -- the trigger covers deletes, not just the screen that had the bug'
);

-- ── 7. Editing a quantity to a part-carton is refused too ─────────────────
select throws_ok(
  $$select pg_temp.set_qty('00000000-0000-0000-0000-0000000001e0',
                           '00000000-0000-0000-0000-0000000001c8', 3)$$,
  '23514',
  null,
  'and so is editing Red down to 3, which would leave 5 bottles'
);

-- ── 8. A loose piece of something that is NOT a mixed-carton brand ────────
-- Every diaper sells in packs and cartons. "Nobody will sell diapers in
-- pieces" -- so a piece line on an ordinary brand is refused outright.
select throws_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e5', 'SO-CTN-6',
      '[{"sku":"00000000-0000-0000-0000-000000000005","uom":"piece","qty":5,"price":10}]'::jsonb)$$,
  '23514',
  null,
  'a loose PIECE of a diaper is refused -- the mixed carton is the only place a single unit is a unit of trade'
);

-- ── 9. And a piece line on a mixed brand still needs the flag ─────────────
select throws_ok(
  $$select pg_temp.mk_order('00000000-0000-0000-0000-0000000001e6', 'SO-CTN-7',
      '[{"sku":"00000000-0000-0000-0000-0000000001c7","uom":"piece","qty":6,"price":36.67}]'::jsonb)$$,
  '23514',
  null,
  'six loose bottles NOT marked as a mixed carton fill is still not a sale'
);

select * from finish();
rollback;

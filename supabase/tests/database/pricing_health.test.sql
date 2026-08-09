-- Pass 14: Margin Watch — what it judges, and what it must never call healthy.
-- Regression guard for migration 0162.
--
-- get_pricing_health drives Margin Watch and had no tests at all. Three bugs,
-- all confirmed against production data on 2026-08-09:
--
--  1. A product priced BELOW LANDED COST read as 'ok'. The only bad verdict
--     was 'below_target', which needs target_margin_pct — and that is NULL on
--     every one of the 26 SKUs holding stock. So the function returns zero
--     rows today, and would keep returning zero rows if a price went under
--     cost. "Losing money is a decision, never an accident."
--
--  2. `worst` was LEAST(m_piece, m_pack, m_carton) with no reference to
--     sellable_units, so a price for a unit the product is NOT sold in could
--     decide its health. 29 of 31 active SKUs carry a piece price and no SKU
--     sells by the piece. Same class as 0139 and 0160.
--
--  3. 'no_price' required all three prices to be NULL, so a pack/carton
--     product carrying only a piece price counted as priced. Two real
--     products are in that state (MAMY-SKIN-XXL-32x3, MAMA-MAMA-1x12) and
--     both read 'ok'.

begin;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000001a0', 'test-health@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000001a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000001a0', true);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000001a1', 'SH-TEST-HEALTH',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

-- Every SKU here needs stock on the shelf: get_pricing_health inner-joins
-- v_batch_stock, so a sold-out product is out of scope by design.
create function pg_temp.stock_it(p_sku uuid, p_line uuid, p_batch uuid,
                                 p_landed numeric, p_pieces integer)
returns void language plpgsql as $$
declare
  v_pcs_per_pack     integer;
  v_packs_per_carton integer;
begin
  -- The per-pack and per-carton landed columns are NOT NULL, and they are the
  -- per-piece cost scaled by the SKU's own pack config — never typed twice.
  select pcs_per_pack, packs_per_carton into v_pcs_per_pack, v_packs_per_carton
  from skus where id = p_sku;

  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (p_line, '00000000-0000-0000-0000-0000000001a1', p_sku, 1, 0.036, 10, 'USD',
          '00000000-0000-0000-0000-000000000006');
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received, landed_per_piece_mvr,
                                 landed_per_pack_mvr, landed_per_carton_mvr)
  values (p_batch, p_line, p_sku, '00000000-0000-0000-0000-000000000006',
          now() - interval '2 days', 1, p_pieces, p_landed,
          p_landed * v_pcs_per_pack,
          p_landed * v_pcs_per_pack * v_packs_per_carton);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (p_batch, p_sku, '00000000-0000-0000-0000-000000000006', 'in', p_pieces, 'shipment');
end $$;

-- ── A. Sold below cost, and NO target margin set ──────────────────────────
-- A carton of 6 bottles costing MVR 240 landed, priced at MVR 200. Every
-- carton sold loses MVR 40. This is the exact shape of every stocked product
-- today: a real cost, a real price, and target_margin_pct NULL.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000004',
        'TEST-BELOWCOST-1x6', 1, 6, 40, 30, 30, 200, array['carton']);
select pg_temp.stock_it('00000000-0000-0000-0000-0000000001a2',
                        '00000000-0000-0000-0000-0000000001a3',
                        '00000000-0000-0000-0000-0000000001a4', 40, 60);

select is(
  (select target_margin_pct from skus where id = '00000000-0000-0000-0000-0000000001a2'),
  null,
  'the below-cost product has NO target margin -- like all 26 stocked SKUs in production'
);

select is(
  (select status from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001a2'),
  'below_cost',
  'a carton costing MVR 240 and priced at MVR 200 is reported below cost -- it used to read "ok", because the only bad verdict needed a target margin that is never set'
);

select is(
  (select worst_margin_pct from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001a2'),
  -20.0::numeric,
  'and the margin is stated as the loss it is'
);

-- ── B. A price only for a unit that is never sold ─────────────────────────
-- Sold by pack and carton; the only price on it is per piece. There is no
-- price for anything a customer can actually buy.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_selling_price_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000001a5', '00000000-0000-0000-0000-000000000004',
        'TEST-PIECEONLY-32x3', 32, 3, 40, 30, 30, 10, array['pack','carton']);
select pg_temp.stock_it('00000000-0000-0000-0000-0000000001a5',
                        '00000000-0000-0000-0000-0000000001a6',
                        '00000000-0000-0000-0000-0000000001a7', 5, 96);

select is(
  (select status from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001a5'),
  'no_price',
  'a pack/carton product carrying only a PIECE price has no sellable price -- two real products are in this state and both read "ok"'
);

-- Prove the fixture carries the trap. (Asserting margin_piece_pct is NULL
-- here would pass for the wrong reason: under the old code this SKU was 'ok'
-- and so absent from the result entirely, which also reads as NULL. The real
-- piece-gate assertion is on the below-target SKU below, which IS returned
-- either way.)
select is(
  (select fixed_selling_price_mvr from skus where id = '00000000-0000-0000-0000-0000000001a5'),
  10::numeric,
  'and the only price it carries really is a per-piece one'
);

-- ── C. THE control: a terrible price on a unit that is not sold ───────────
-- Pack-only. The pack price is healthy (43.3% on a 40% target). The carton
-- price is catastrophic — MVR 100 for MVR 510 of goods — but the product is
-- never sold by the carton, so it is not a real loss and must not be flagged.
-- Under the old LEAST(...) this was -410% and would have shouted.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr,
                  target_margin_pct, sellable_units)
values ('00000000-0000-0000-0000-0000000001a8', '00000000-0000-0000-0000-000000000004',
        'TEST-PACKONLY-34x3', 34, 3, 40, 30, 30, 300, 100, 40, array['pack']);
select pg_temp.stock_it('00000000-0000-0000-0000-0000000001a8',
                        '00000000-0000-0000-0000-0000000001a9',
                        '00000000-0000-0000-0000-0000000001b0', 5, 102);

select is_empty(
  $$select internal_code from get_pricing_health()
     where sku_id = '00000000-0000-0000-0000-0000000001a8'$$,
  'a pack-only product with a healthy PACK price is not flagged for a ruinous carton price it never charges'
);

-- Prove the control really carries the trap, so the assertion above is not
-- passing for some unrelated reason: MVR 100 for MVR 510 of goods is on the
-- record, it is simply not a unit anyone is charged for.
select is(
  (select fixed_price_per_carton_mvr from skus where id = '00000000-0000-0000-0000-0000000001a8'),
  100::numeric,
  'and that ruinous carton price really is set on the product'
);

-- ── D. Below target, and what gets suggested ──────────────────────────────
-- Pack-only, 50% target, pack priced at about 30%. Also carries a carton
-- price, which must be ignored everywhere: verdict, margin AND suggestion.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr,
                  fixed_selling_price_mvr, target_margin_pct, sellable_units)
values ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-000000000004',
        'TEST-BELOWTARGET-40x4', 40, 4, 40, 30, 30, 286, 2000, 10, 50, array['pack']);
select pg_temp.stock_it('00000000-0000-0000-0000-0000000001b1',
                        '00000000-0000-0000-0000-0000000001b2',
                        '00000000-0000-0000-0000-0000000001b3', 5, 160);

select is(
  (select status from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001b1'),
  'below_target',
  'a 30% margin against a 50% target is still reported -- below_cost did not swallow the milder verdict'
);

select is(
  (select margin_carton_pct from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001b1'),
  null,
  'no carton margin on a pack-only product, even though a carton price is set'
);

-- The piece gate, on a row that is returned under BOTH the old and the new
-- function, so a NULL here means the gate worked and not that the row is gone.
select is(
  (select margin_piece_pct from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001b1'),
  null,
  'and no piece margin either -- not one SKU in the business sells by the piece'
);

select is(
  (select suggested_pack_mvr from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001b1'),
  400::numeric,
  'the suggested PACK price hits the 50% target on a MVR 200 pack'
);

select is(
  (select suggested_carton_mvr from get_pricing_health() where sku_id = '00000000-0000-0000-0000-0000000001b1'),
  null,
  'and no carton price is suggested for a unit the product is not sold in -- a suggestion Ali could accept is an offer he cannot fill'
);

-- Losing money outranks missing a target: the worst thing must be read first.
select cmp_ok(
  (select ord from (
     select sku_id, row_number() over () as ord from get_pricing_health()
   ) x where x.sku_id = '00000000-0000-0000-0000-0000000001a2'),
  '<',
  (select ord from (
     select sku_id, row_number() over () as ord from get_pricing_health()
   ) x where x.sku_id = '00000000-0000-0000-0000-0000000001b1'),
  'the below-cost product is listed above the below-target one'
);

select * from finish();
rollback;

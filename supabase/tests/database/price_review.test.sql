-- The price review after an arrival — migration 0213.
--
-- Ali, 2026-08-27, the morning after SH-2026-002 landed at more than double the
-- freight rate per CBM: *"For me to set the selling price with the best profit
-- how do I see it? ... Also how do I know compared the 001 shipment price."*
--
-- What these tests defend, in the order the money matters:
--
--  A. A fixed price does not move with the cost, so the margin absorbs the
--     whole rise. The review must name the previous arrival, the new cost, and
--     a price that genuinely puts the old margin back — ROUNDED UP, because a
--     suggestion that rounds down quietly restores less than it claims.
--
--  B. A FLOATING price (no fixed figure, only a target margin) moved with the
--     cost by itself and its margin never changed. Comparing today's price
--     against the OLD cost invents a margin that was never earned and then
--     "restores" it by pushing the price higher. This is the live case:
--     X-Tra Kering NB/S took the same 28% rise as everything else and held
--     44.9%; naive arithmetic reports 57% and demands MVR 279 a pack. The
--     verdict must be `auto_adjusted` with NO suggestion at all.
--
--  C. Restoring a margin is arithmetic; whether the price is SELLABLE is not.
--     Where the restoring price lands above what the shops charge, the review
--     must say so (`capped_by_market`) instead of handing over a number Ali
--     cannot charge. Sosoft is the real instance — MVR 56 a bottle restores
--     40%, and the shelf price is MVR 36.
--
--  D. set_selling_prices carries the below-cost guard (hard rule 7) and
--     refuses a unit the product is not sold in, in Postgres, where no screen
--     can forget it.

begin;
select plan(23);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000005a0', 'test-review@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000005a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000005a0', true);

-- Two arrivals: an older one and the one under review. Both must be
-- grn_confirmed, because a shipment still on the water has no landed cost to
-- compare against and must never be reviewed.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr, status, grn_confirmed_at)
values ('00000000-0000-0000-0000-0000000005a1', 'SH-TEST-OLD', '00000000-0000-0000-0000-000000000007',
        20.5, 16000, 'grn_confirmed', now() - interval '50 days'),
       ('00000000-0000-0000-0000-0000000005a2', 'SH-TEST-NEW', '00000000-0000-0000-0000-000000000007',
        21.5, 16000, 'grn_confirmed', now() - interval '1 day');

-- One helper, used for both arrivals, so a cost is never typed twice: the
-- per-pack and per-carton columns are the per-piece figure scaled by the SKU's
-- own pack config.
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
-- A. A FIXED PRICE. Cost per pack MVR 100 → 125; price MVR 200 stands still.
--    Margin 50% → 37.5%. Restoring 50% needs 125 / 0.5 = MVR 250 exactly.
-- ══════════════════════════════════════════════════════════════════════════
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000005b0', '00000000-0000-0000-0000-000000000004',
        'TEST-REVIEW-FIXED-10x2', 10, 2, 40, 30, 30, 200, 400, array['pack','carton']);
select pg_temp.land('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005b0',
                    '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b2',
                    10, 20, now() - interval '50 days');
select pg_temp.land('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005b0',
                    '00000000-0000-0000-0000-0000000005b3', '00000000-0000-0000-0000-0000000005b4',
                    12.5, 20, now() - interval '1 day');

select is(
  (select prev_reference from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  'SH-TEST-OLD',
  'the review names the arrival it is comparing against -- the question Ali actually asked'
);

select is(
  (select prev_cost_unit from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  100.00::numeric,
  'the previous cost is what ONE PACK cost on that arrival, not a per-piece figure'
);

select is(
  (select this_cost_unit from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  125.00::numeric,
  'and the new cost is what one pack costs now'
);

select is(
  (select margin_before_pct || ' -> ' || margin_now_pct from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  '50.0 -> 37.5',
  'a price that stood still gave the whole cost rise away out of margin'
);

select is(
  (select profit_now_unit from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  75.00::numeric,
  'and the rufiyaa it still earns per pack is stated, because money leads and percentages follow'
);

select is(
  (select verdict from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  'raise',
  'the verdict is to raise it'
);

select is(
  (select suggested_unit from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  250::numeric,
  'restoring 50% on a MVR 125 pack is MVR 250 per pack'
);

select is(
  (select suggested_carton from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  500::numeric,
  'and MVR 500 per carton -- the carton never drifts out of step with the pack it is made of'
);

-- ROUNDING GOES UP, ALWAYS. 251.03 rounding to 250 would hand back a margin
-- lower than the one the suggestion claims to restore, and nothing on screen
-- would say so.
select cmp_ok(
  (select (250::numeric - 125) / 250), '>=', 0.5::numeric,
  'the suggested price really does earn at least the margin it promises'
);
select is(price_point(251.03), 255::numeric, 'a suggestion above MVR 100 rounds UP to the next 5');
select is(price_point(33.2),    34::numeric, 'and a small unit price rounds UP to the next whole rufiyaa');

-- ══════════════════════════════════════════════════════════════════════════
-- B. A FLOATING PRICE. Same 25% cost rise, but the price is derived from a
--    40% target margin, so it moved by itself. Its margin never changed.
--
--    THIS IS THE MUTATION-SENSITIVE TEST. Drop the price_is_fixed branch in
--    `scored` and this SKU reports a margin it never earned and a suggestion
--    to raise a price that is already correct.
-- ══════════════════════════════════════════════════════════════════════════
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  target_margin_pct, sellable_units)
values ('00000000-0000-0000-0000-0000000005c0', '00000000-0000-0000-0000-000000000004',
        'TEST-REVIEW-FLOAT-10x2', 10, 2, 40, 30, 30, 40, array['pack','carton']);
select pg_temp.land('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005c0',
                    '00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005c2',
                    10, 20, now() - interval '50 days');
select pg_temp.land('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005c0',
                    '00000000-0000-0000-0000-0000000005c3', '00000000-0000-0000-0000-0000000005c4',
                    12.5, 20, now() - interval '1 day');

select is(
  (select verdict from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005c0'),
  'auto_adjusted',
  'a product with no fixed price looked after itself -- its price moved with the cost'
);

select is(
  (select margin_before_pct = margin_now_pct from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005c0'),
  true,
  'so its margin did not move at all, and the review must not invent one it never earned'
);

select is(
  (select coalesce(suggested_unit, suggested_carton) from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005c0'),
  null,
  'and there is nothing to suggest -- pushing this price higher would be pure invention'
);

-- ══════════════════════════════════════════════════════════════════════════
-- C. THE MARKET CAP. Cost per bottle MVR 20 → 32, price MVR 35, so restoring
--    the old 42.9% needs MVR 56. The shops are at MVR 36. Arithmetic says
--    raise; the business says you cannot.
-- ══════════════════════════════════════════════════════════════════════════
insert into variants (id, model_id, display_name)
values ('00000000-0000-0000-0000-0000000005d9', '00000000-0000-0000-0000-000000000003', 'Test Bottle');

insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000005d0', '00000000-0000-0000-0000-0000000005d9',
        'TEST-REVIEW-CAPPED-1x6', 1, 6, 40, 30, 30, 35, 210, array['pack','carton']);
select pg_temp.land('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005d0',
                    '00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-0000000005d2',
                    20, 6, now() - interval '50 days');
select pg_temp.land('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005d0',
                    '00000000-0000-0000-0000-0000000005d3', '00000000-0000-0000-0000-0000000005d4',
                    32, 6, now() - interval '1 day');

insert into competitors (id, name) values ('00000000-0000-0000-0000-0000000005d5', 'Test Shop');
insert into competitor_prices (competitor_id, variant_id, their_pcs_per_pack, price_mvr, price_basis, observed_date)
values ('00000000-0000-0000-0000-0000000005d5', '00000000-0000-0000-0000-0000000005d9', 1, 36, 'per_pack', current_date);

select is(
  (select verdict from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005d0'),
  'capped_by_market',
  'a price that restores the margin but beats the shelf price is not an answer -- say so instead of handing it over'
);

select is(
  (select market_unit_mvr from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005d0'),
  36::numeric,
  'and the shelf price is quoted in Ali own selling unit, so the two numbers are comparable at a glance'
);

-- ══════════════════════════════════════════════════════════════════════════
-- D. THE WRITER. One guard, every door.
-- ══════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$select set_selling_prices('00000000-0000-0000-0000-0000000005b0'::uuid, 100, null)$$,
  'MVR 100.00 per pack is below what it costs you (MVR 125.00). Confirm the loss to set it anyway.',
  'a price under landed cost is refused with the real rufiyaa -- losing money is a decision, never an accident'
);

-- Pack-only product, offered a carton price. The screens guard this; so must
-- the writer, because it is a different door onto the same money.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000005e0', '00000000-0000-0000-0000-000000000004',
        'TEST-REVIEW-PACKONLY-10x2', 10, 2, 40, 30, 30, 200, array['pack']);

select throws_ok(
  $$select set_selling_prices('00000000-0000-0000-0000-0000000005e0'::uuid, null, 500)$$,
  'This product is not sold by the carton',
  'and a carton price on a pack-only product is refused, so no screen can quote a price nobody can be charged'
);

select ok(
  not has_function_privilege('anon', 'public.get_price_review(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_selling_prices(uuid,numeric,numeric,boolean,text)', 'execute'),
  'anon can execute neither the review nor the writer'
);

-- ══════════════════════════════════════════════════════════════════════════
-- E. THE RATCHET (migration 0214). Accepting a suggestion must END the review
--    for that product, not re-anchor it on the price just set.
--
--    Left unfixed: price 200 → accept 250 → "used to earn" becomes
--    (250−100)/250 = 60% → suggests 313 → accept → suggests 391 → ...
--    Nothing looks out of balance; the screen simply never says done, and each
--    tap talks Ali into a bigger rise than the last.
-- ══════════════════════════════════════════════════════════════════════════
select set_selling_prices('00000000-0000-0000-0000-0000000005b0'::uuid, 250, 500);

select is(
  (select verdict from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  'repriced',
  'once the price is set the review is finished for that product -- it must not ask again'
);

select cmp_ok(
  (select coalesce(suggested_unit, 0) from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  '<=', 250::numeric,
  'and it never comes back asking for MORE than the price just accepted'
);

-- The row is not hidden either: a tap that made things worse must stay visible,
-- so the margin it now earns is still reported.
select is(
  (select margin_now_pct from get_price_review('00000000-0000-0000-0000-0000000005a2') where sku_id = '00000000-0000-0000-0000-0000000005b0'),
  50.0::numeric,
  'the repriced product still reports the margin it now earns -- settled, not swept away'
);

-- AND THE CHANGE IS IN THE LEDGER, with both figures, in the unit sold.
select ok(
  exists (
    select 1 from audit_log
     where table_name = 'skus'
       and record_id = '00000000-0000-0000-0000-0000000005b0'
       and field_name = 'selling_price'
       and old_value like '200%'
       and new_value like '250%'
  ),
  'every price change is audit-logged with what it was and what it became'
);

select * from finish();
rollback;

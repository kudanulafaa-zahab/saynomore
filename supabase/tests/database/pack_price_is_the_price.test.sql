-- The PACK price is the price. Per-piece is derived from it.
--
-- Ali, 2026-08-30:
--   *"For all diapers can you make sure the price is calculated in packs and
--    cartons? Nobody will sell diapers in pieces. All the math related must be
--    correct. All diaper SKUs must follow it. The only reason I need per piece
--    pricing is because competitor pack count is different."*
--
-- ── WHAT WAS UPSIDE DOWN ──────────────────────────────────────────────────
--
-- v_skus took a PER-PIECE column as the base and built the pack price up from
-- it, so the number Ali actually decides was stored as a fraction of itself:
-- 160 a pack became 3.64, which multiplied back to 160 by luck and showed as
-- MVR 4.00 a nappy — 9.9% high, and a price nobody is ever charged.
--
-- The pack price also had its own column, so one product could hold two prices
-- that disagreed. Six X-Tra Kering SKUs did, by about 8%, and which one won
-- depended on the screen.
--
-- ── THE INVARIANT ─────────────────────────────────────────────────────────
--
-- One direction of travel: pack -> piece, never back. These assertions are
-- about the RELATIONSHIP, not about any particular price, so they keep holding
-- when Ali reprices.

begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000c10', 'test-packprice@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000c10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c10', true);

-- ══════════════════════════════════════════════════════════════════════════
-- THE WHOLE CATALOGUE, NOT A FIXTURE
-- ══════════════════════════════════════════════════════════════════════════
-- The seed carries real pack configurations, so this holds the rule across
-- every priced product rather than one convenient example.
select is(
  (select count(*)::int from v_skus
    where selling_price_per_pack_mvr is not null and pcs_per_pack > 0
      and round(selling_price_per_piece_mvr, 6)
          is distinct from round(selling_price_per_pack_mvr / pcs_per_pack::numeric, 6)),
  0,
  'no product prices a piece independently of its pack'
);

-- ══════════════════════════════════════════════════════════════════════════
-- A DIAPER: THE PACK IS TYPED, EVERYTHING ELSE FOLLOWS
-- ══════════════════════════════════════════════════════════════════════════
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000c20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test PackPrice Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000c21', '00000000-0000-0000-0000-000000000c20',
        'PackPrice NBS', '{"size":"NBS-packprice"}'::jsonb);

-- 44 to a pack, MVR 160 a pack. Nothing per-piece is stored at all — which is
-- the point: the pack price is the only price entered.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000c22', '00000000-0000-0000-0000-000000000c21',
        'TEST-PACKPRICE-44x4', 44, 4, 35, 20, 45, 160, array['pack','carton']);

select is(
  (select selling_price_per_pack_mvr from v_skus where id = '00000000-0000-0000-0000-000000000c22'),
  160::numeric,
  'the pack price is exactly what was typed'
);

-- 160 / 44 = 3.63636..., NOT 3.64 and certainly not 4.
select is(
  (select round(selling_price_per_piece_mvr, 4) from v_skus
    where id = '00000000-0000-0000-0000-000000000c22'),
  3.6364::numeric,
  'and the per-piece figure is the pack divided by the pack size, at full precision'
);

-- The old model rounded this to a whole rufiyaa. That is the specific defect.
select cmp_ok(
  (select selling_price_per_piece_mvr from v_skus where id = '00000000-0000-0000-0000-000000000c22'),
  '<>',
  4::numeric,
  'never rounded to a whole rufiyaa — that was 9.9% high on this very product'
);

select is(
  (select selling_price_per_carton_mvr from v_skus where id = '00000000-0000-0000-0000-000000000c22'),
  640::numeric,
  'a carton with no break of its own is 4 packs at the pack price'
);

-- ══════════════════════════════════════════════════════════════════════════
-- A CARTON BREAK IS A REAL BREAK AND OVERRIDES
-- ══════════════════════════════════════════════════════════════════════════
-- Ali gives MVR 20 off a carton across almost the whole catalogue.
update skus set fixed_price_per_carton_mvr = 620
 where id = '00000000-0000-0000-0000-000000000c22';

select is(
  (select selling_price_per_carton_mvr from v_skus where id = '00000000-0000-0000-0000-000000000c22'),
  620::numeric,
  'a carton price of its own wins over 4 x the pack price'
);

-- ...and it must NOT drag the pack or the piece down with it. A carton buyer's
-- discount is not a shelf price.
select is(
  (select selling_price_per_pack_mvr from v_skus where id = '00000000-0000-0000-0000-000000000c22'),
  160::numeric,
  'while the pack price is untouched by the carton break'
);

select is(
  (select round(selling_price_per_piece_mvr, 4) from v_skus
    where id = '00000000-0000-0000-0000-000000000c22'),
  3.6364::numeric,
  'and so is the per-piece figure, which follows the pack and not the carton'
);

-- ══════════════════════════════════════════════════════════════════════════
-- A ONE-PIECE PACK: THE PIECE IS THE TRADE UNIT AND MUST STAY WHOLE
-- ══════════════════════════════════════════════════════════════════════════
-- A Sosoft bottle is 1 per pack, so the pack price IS the bottle price and
-- MVR 37 is what he charges. Deriving from the pack keeps that exact, which is
-- why this rule needs no special case for it — and why "just stop rounding
-- everywhere" would have been the wrong fix.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000c23', '00000000-0000-0000-0000-000000000c20',
        'PackPrice Bottle', '{"size":"bottle-packprice"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000c24', '00000000-0000-0000-0000-000000000c23',
        'TEST-PACKPRICE-1x6', 1, 6, 30, 20, 25, 37, 220, array['pack','carton']);

select is(
  (select selling_price_per_piece_mvr from v_skus where id = '00000000-0000-0000-0000-000000000c24'),
  37::numeric,
  'a bottle is exactly MVR 37, because one piece is one pack'
);

-- ══════════════════════════════════════════════════════════════════════════
-- NO DIAPER IS SELLABLE BY THE PIECE
-- ══════════════════════════════════════════════════════════════════════════
-- The per-piece figure exists to compare against rivals who sell 30s and 48s.
-- It is never something a customer can buy.
select is(
  (select count(*)::int from v_skus vs
     join variants v on v.id = vs.variant_id
     join product_models m on m.id = v.model_id
     join product_categories c on c.id = m.category_id
    where c.name = 'Diapers' and 'piece' = any(vs.sellable_units)),
  0,
  'and no diaper offers a piece as something to buy'
);

select * from finish();
rollback;

-- A carton you cannot sell is not a carton.
--
-- Ali, 2026-08-30, blocked mid-sale:
--   *"In sales add new sale mamypoko xtra kering xxxl 32pcs/pack which comes in
--    3 packs per carton. I cannot sell by carton. The feature is not there."*
--
-- The feature was there. MAMY-XTRA-XXXL-32x3 said `sellable_units = {pack}`
-- while also saying a carton holds 3 packs and pricing one at MVR 790. One row,
-- contradicting itself, in a catalogue of 31 — and every screen believed it,
-- correctly, because sellableTiers() offers exactly what a SKU says it sells.
--
-- ── THE RULE HAD ONLY EVER BEEN WRITTEN ONE WAY ───────────────────────────
--
-- "Never OFFER a selling unit the SKU doesn't sell" was enforced everywhere.
-- Its mirror — "never WITHHOLD a unit the SKU plainly does sell" — was written
-- nowhere at all, so this failed silently instead of raising anything. That
-- asymmetry is what these assertions close, and it is why they are about the
-- RULE rather than about one product: a test naming only the XXXL would pass
-- on the day the next SKU is set up the same way.

begin;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000f10', 'test-cartonsell@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000f10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000f10', true);

insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000f20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test Carton Sellable Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000f21', '00000000-0000-0000-0000-000000000f20',
        'CartonSell XXXL', '{"size":"XXXL-cartonsell"}'::jsonb);

-- ══════════════════════════════════════════════════════════════════════════
-- THE EXACT SHAPE OF THE DEFECT IS REFUSED
-- ══════════════════════════════════════════════════════════════════════════
-- 32 to a pack, 3 packs to a carton, sellable by the pack only. That is what
-- shipped, and it must now be impossible to write.
select throws_ok(
  $$insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                      carton_length_cm, carton_width_cm, carton_height_cm,
                      fixed_price_per_pack_mvr, sellable_units)
    values ('00000000-0000-0000-0000-000000000f22', '00000000-0000-0000-0000-000000000f21',
            'TEST-CARTONSELL-32x3', 32, 3, 40, 30, 25, 290, array['pack'])$$,
  '23514',
  null,
  'a product that ships 3 packs to a carton cannot be pack-only'
);

-- The honest version of the same product is accepted.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000f22', '00000000-0000-0000-0000-000000000f21',
        'TEST-CARTONSELL-32x3', 32, 3, 40, 30, 25, 290, 790, array['pack','carton']);

select is(
  (select sellable_units from skus where id = '00000000-0000-0000-0000-000000000f22'),
  array['pack','carton'],
  'and the same product sells both a pack and a carton'
);

-- Taking the carton away again is the regression this exists to stop.
select throws_ok(
  $$update skus set sellable_units = array['pack']
     where id = '00000000-0000-0000-0000-000000000f22'$$,
  '23514',
  null,
  'and the carton cannot be quietly taken away later'
);

-- ══════════════════════════════════════════════════════════════════════════
-- A CARTON OF ONE PACK IS NOT A SEPARATE UNIT
-- ══════════════════════════════════════════════════════════════════════════
-- The rule is "a carton that holds more than one pack is a real trade unit",
-- not "everything must sell by the carton". A 1-pack carton is the same thing
-- twice and must stay allowed, or Body Shop's single-tub cartons break.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000f23', '00000000-0000-0000-0000-000000000f20',
        'CartonSell Tub', '{"size":"tub-cartonsell"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000f24', '00000000-0000-0000-0000-000000000f23',
        'TEST-CARTONSELL-1x1', 1, 1, 20, 20, 20, 120, array['pack']);

select is(
  (select packs_per_carton from skus where id = '00000000-0000-0000-0000-000000000f24'),
  1,
  'a carton holding one pack may still be sold by the pack alone'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE WHOLE CATALOGUE, NOT A FIXTURE
-- ══════════════════════════════════════════════════════════════════════════
-- Stated as rules so they hold on any database: an empty catalogue passes,
-- and so does one that has moved on.
select is(
  (select count(*)::int from skus
    where packs_per_carton > 1 and not ('carton' = any(sellable_units))),
  0,
  'no product anywhere ships in cartons it cannot sell'
);

-- The tell that would have caught this a month early: a price for a unit that
-- cannot be bought. Somebody priced that carton at MVR 790 on purpose.
select is(
  (select count(*)::int from skus
    where fixed_price_per_carton_mvr is not null
      and not ('carton' = any(sellable_units))),
  0,
  'and no product carries a carton price it cannot charge'
);

select is(
  (select count(*)::int from skus
    where not ('pack' = any(sellable_units)) and not ('carton' = any(sellable_units))),
  0,
  'and every product can be sold as something'
);

select * from finish();
rollback;

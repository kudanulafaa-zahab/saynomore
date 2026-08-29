-- Which container the simulator is costing like — migration 0220.
--
-- Ali, 2026-08-29:
--   *"In prices, pricing tool where is it getting the landed cost from? How
--    does it apply between grns? 002 is much higher price than 001. So is
--    this tool accurate?"*
--
-- The arithmetic was never wrong. The ASSUMPTION was picked silently: the
-- screen seeded from whichever shipment was newest, and freight is charged by
-- VOLUME, so the rate belongs to one container rather than to the trade.
--
--     SH-2026-001   8.01 CBM   MVR 19,156 freight   =  MVR 2,392 per CBM
--     SH-2026-002   2.69 CBM   MVR 13,829 freight   =  MVR 5,133 per CBM
--
-- Simulating a full container at the small one's rate over-costs every line
-- and argues him out of supplier quotes that are perfectly good.
--
-- What these tests defend:
--
--  A. The default is unchanged — the newest arrival. Nobody's saved habit
--     breaks because a picker appeared.
--  B. A chosen arrival is honoured, and brings ITS OWN forex and charges, not
--     a blend. Every shipment stands alone (CLAUDE.md).
--  C. The per-CBM rate is computed in Postgres from the shipment's own lines,
--     on the same volume basis confirm_grn apportions freight over — so the
--     rate quoted is the rate that produced the landed costs in the ledger.
--  D. No no-argument twin survives, and anon cannot execute it.

begin;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000007a0', 'test-costing@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000007a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a0', true);

-- Two arrivals with deliberately different shapes: a big cheap-per-CBM one and
-- a small dear-per-CBM one, which is the real pattern in Ali's data.
--   OLD: 10 cartons x 0.8 CBM = 8 CBM, USD 400 freight at 20 = MVR 8,000
--        -> MVR 1,000 per CBM
--   NEW:  2 cartons x 0.5 CBM = 1 CBM, USD 200 freight at 25 = MVR 5,000
--        -> MVR 5,000 per CBM
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr,
                       status, grn_confirmed_at, my_freight_share_usd,
                       mpl_charges_mvr, agent_fee_mvr, last_mile_mvr)
values ('00000000-0000-0000-0000-0000000007a1', 'SH-COST-OLD', '00000000-0000-0000-0000-000000000007',
        20, 16000, 'grn_confirmed', now() - interval '40 days', 400, 100, 200, 300),
       ('00000000-0000-0000-0000-0000000007a2', 'SH-COST-NEW', '00000000-0000-0000-0000-000000000007',
        25, 16500, 'grn_confirmed', now() - interval '1 day',  200, 700, 800, 900);

insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm, sellable_units)
values ('00000000-0000-0000-0000-0000000007b0', '00000000-0000-0000-0000-000000000004',
        'TEST-COSTING-SEED-10x2', 10, 2, 40, 30, 30, array['pack','carton']);

insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007a1',
        '00000000-0000-0000-0000-0000000007b0', 10, 0.8, 40, 'USD', '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007a2',
        '00000000-0000-0000-0000-0000000007b0',  2, 0.5, 40, 'USD', '00000000-0000-0000-0000-000000000006');

-- ══════════════════════════════════════════════════════════════════════════
-- A. The default is still the newest arrival
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select reference from get_costing_defaults()),
  'SH-COST-NEW',
  'with nothing chosen the simulator still opens on the most recent arrival'
);

-- ══════════════════════════════════════════════════════════════════════════
-- B. A chosen arrival brings its own numbers, not a blend
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select reference from get_costing_defaults('00000000-0000-0000-0000-0000000007a1')),
  'SH-COST-OLD',
  'choosing an earlier arrival seeds from THAT container'
);

select is(
  (select rate_usd_to_mvr from get_costing_defaults('00000000-0000-0000-0000-0000000007a1')),
  20::numeric,
  'and brings its own forex rate -- never an average across shipments'
);

-- The local charges move together with it. Half-seeded defaults would be worse
-- than none: the forex from one container and the clearing from another is a
-- shipment that never existed.
select is(
  (select mpl_charges_mvr || '/' || agent_fee_mvr || '/' || last_mile_mvr
     from get_costing_defaults('00000000-0000-0000-0000-0000000007a1')),
  '100.00/200.00/300.00',
  'and its own clearing charges, so the seed is one real shipment throughout'
);

-- ══════════════════════════════════════════════════════════════════════════
-- C. The per-CBM rate — the figure that says whether a simulation is realistic
-- ══════════════════════════════════════════════════════════════════════════
-- USD 400 x 20 = MVR 8,000 over 10 x 0.8 = 8 CBM.
select is(
  (select freight_mvr_per_cbm from get_costing_defaults('00000000-0000-0000-0000-0000000007a1')),
  1000::numeric,
  'the big container reports MVR 1,000 per CBM'
);

-- USD 200 x 25 = MVR 5,000 over 2 x 0.5 = 1 CBM. Five times the rate for the
-- same trade -- which is real, not an error, and is exactly why it must be
-- visible before he prices a container against it.
select is(
  (select freight_mvr_per_cbm || ' over ' || cbm_total from get_costing_defaults('00000000-0000-0000-0000-0000000007a2')),
  '5000 over 1.00',
  'and the small one reports MVR 5,000 per CBM, named with the volume behind it'
);

-- ══════════════════════════════════════════════════════════════════════════
-- D. One version of the answer, closed to anon
-- ══════════════════════════════════════════════════════════════════════════
select ok(
  to_regprocedure('public.get_costing_defaults()') is null
  and not has_function_privilege('anon', 'public.get_costing_defaults(uuid)', 'execute'),
  'no no-argument twin survives, and anon cannot execute it'
);

select * from finish();
rollback;

-- A product's CODE and its pack configuration must say the same thing.
--
-- The SKU code convention is BRAND-MODEL-SIZE-{pcs_per_pack}x{packs_per_carton},
-- so MAMY-XTRA-XXXL-32x3 states 32 to a pack, 3 packs to a carton. When the
-- code and the configuration disagree, one of them is a lie and there is no way
-- to tell which by looking at the screen.
--
-- ── WHY THIS SUITE EXISTS AT ALL ──────────────────────────────────────────
--
-- Two products drifted this way, in OPPOSITE directions, three weeks apart:
--
--   XXXL          the CODE was wrong. It read 34x3 and Ali confirmed the
--                 carton holds 3 packs of 32. Fixed by restating the pack
--                 size (0224-0226) because stock and sales depended on it.
--   Skin Comfort  the CONFIGURATION was right and the code was wrong. Every
--                 recorded fact -- a 5-carton receipt of 640 pieces, three
--                 sales, and 288 pieces on the shelf which is exactly 9 packs
--                 at 32 -- said 32, while the code said 34. Fixed by renaming
--                 (0231), because nothing derives from a code.
--
-- CLAUDE.md's rule is "the code is right and the other number is the bug". It
-- held for one of those and not the other, so neither this test nor anyone
-- reading it should assume a direction. What it asserts is only that the two
-- must AGREE -- catching the drift, and leaving which side to correct to
-- whoever can count a real carton.

begin;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000d10', 'test-codecfg@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000d10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000d10', true);

-- ══════════════════════════════════════════════════════════════════════════
-- THE WHOLE CATALOGUE
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from skus
    where internal_code ~ '[0-9]+x[0-9]+$'
      and pcs_per_pack <> substring(internal_code from '([0-9]+)x[0-9]+$')::int),
  0,
  'no product code claims a pack size its configuration disagrees with'
);

select is(
  (select count(*)::int from skus
    where internal_code ~ '[0-9]+x[0-9]+$'
      and packs_per_carton <> substring(internal_code from '[0-9]+x([0-9]+)$')::int),
  0,
  'and none claims a carton size its configuration disagrees with'
);

-- ══════════════════════════════════════════════════════════════════════════
-- AND THE CODE FOLLOWS A RESTATEMENT
-- ══════════════════════════════════════════════════════════════════════════
-- correct_pack_config rewrites the code alongside the configuration. If it ever
-- stopped doing that, every corrected product would immediately fail the two
-- assertions above -- which is the point of checking it here rather than
-- trusting the function's own comment.
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000d20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test CodeCfg Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000d21', '00000000-0000-0000-0000-000000000d20',
        'CodeCfg L', '{"size":"L-codecfg"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000d22', '00000000-0000-0000-0000-000000000d21',
        'TEST-CODECFG-34x3', 34, 3, 52, 20, 34, 270, array['pack']);

-- Give it a receipt so the pack size is genuinely locked and the restatement
-- path is the only way through.
insert into inventory_batches (id, sku_id, godown_id, received_at, source,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000d23', '00000000-0000-0000-0000-000000000d22',
        '00000000-0000-0000-0000-000000000006', now() - interval '10 days', 'direct',
        1, 102, 5.3345, 181.3725, 544.1175);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
values ('00000000-0000-0000-0000-000000000d23', '00000000-0000-0000-0000-000000000d22',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'direct_receipt', now() - interval '10 days');

select lives_ok(
  $$select correct_pack_config('00000000-0000-0000-0000-000000000d22', 32, 3,
      'Counted a carton: 3 packs of 32')$$,
  'a pack size can be restated once stock exists'
);

select is(
  (select internal_code from skus where id = '00000000-0000-0000-0000-000000000d22'),
  'TEST-CODECFG-32x3',
  'and the code is rewritten with it, so the two never drift apart'
);

select * from finish();
rollback;

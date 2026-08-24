-- Pass 21: a name typed wrong can be typed right, and nothing else moves.
-- Regression guard for migration 0205.
--
-- Ali, 2026-08-24: *"I entered a product name by mistake. Example Bodyshop
-- bodymilk. I don't have a bodymilk it's a mistake. How can I correct this and
-- any other future mistakes? Like spelling mistakes or a different name by
-- mistake?"* — and, asked whether the product was real or invented:
-- *"Wrong name."*
--
-- He could not correct it. `BODY-BODY-1x1` has 4 tubs in stock, so delete was
-- correctly blocked; and rename did not exist anywhere in the app, so a typo
-- was permanent.
--
-- ── WHAT THIS FILE IS REALLY GUARDING ───────────────────────────────────────
--
-- Not "does the string change" — that part is one UPDATE and could hardly fail.
-- The reason a rename is worth a test file is everything it must NOT do:
--
--   * not detach a single batch, movement or order line from the product
--   * not change the SKU code, which is printed on labels and paperwork
--   * not let two brands end up sharing a name by a silent merge
--   * not happen without an audit row saying who, from what, to what
--   * not be reachable by a viewer, or by anyone not signed in
--
-- A rename that quietly moved 4 tubs off their landed cost would look exactly
-- like a rename that worked.

begin;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000210', 'test-rename@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000210';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000210', true);

-- A product in exactly Ali's situation: real stock, never sold, wrong name.
insert into brands (id, name) values ('00000000-0000-0000-0000-000000000211', 'Bodyshop Audit');
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000211',
        (select category_id from product_models
          where id = (select model_id from variants where id = '00000000-0000-0000-0000-000000000004')),
        'Bodymilk');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000213', '00000000-0000-0000-0000-000000000212',
        'Bodymilk', '{"size":"Bodymilk"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000214', '00000000-0000-0000-0000-000000000213',
        'BODYA-BODY-1x1', 1, 1, 20, 20, 20, 380, array['pack']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000215', 'SH-TEST-RENAME',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000216', '00000000-0000-0000-0000-000000000215',
        '00000000-0000-0000-0000-000000000214', 4, 0.008, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000217', '00000000-0000-0000-0000-000000000216',
        '00000000-0000-0000-0000-000000000214', '00000000-0000-0000-0000-000000000006',
        now() - interval '3 days', 4, 4, 123, 123, 123);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000217', '00000000-0000-0000-0000-000000000214',
        '00000000-0000-0000-0000-000000000006', 'in', 4, 'shipment');

-- ── THE SITUATION, ASSERTED BEFORE THE FIX ─────────────────────────────────
-- Without this the rename tests below could pass on a product with no history
-- at all, which is the easy case and not his.
select is(
  (select count(*)::int from stock_movements where sku_id = '00000000-0000-0000-0000-000000000214'),
  1,
  'the mistyped product really does carry stock -- which is why deleting it was never the answer'
);

-- ── RENAME THE PRODUCT ─────────────────────────────────────────────────────
select is(
  rename_catalogue_part('model', '00000000-0000-0000-0000-000000000212', 'Body Butter'),
  'Bodymilk',
  'renaming returns the OLD name, so the screen can tell him exactly what changed'
);
select is(
  (select name from product_models where id = '00000000-0000-0000-0000-000000000212'),
  'Body Butter',
  'and the product is now called what he meant'
);

-- ── NOTHING DETACHED ───────────────────────────────────────────────────────
-- The whole reason rename beats delete-and-recreate.
select is(
  (select count(*)::int from stock_movements where sku_id = '00000000-0000-0000-0000-000000000214'),
  1,
  'the stock is still attached -- a rename moves no transaction'
);
select is(
  (select round(landed_per_piece_mvr, 2) from inventory_batches
    where id = '00000000-0000-0000-0000-000000000217'),
  123.00::numeric,
  'and the batch still carries the cost those tubs landed at'
);

-- ── THE CODE DOES NOT CHANGE ───────────────────────────────────────────────
-- Deliberate, and the universal convention: the code is the permanent
-- reference that ends up on labels and paperwork; the name is the description.
-- Regenerating a code already written down is worse than a stale prefix.
select is(
  (select internal_code from skus where id = '00000000-0000-0000-0000-000000000214'),
  'BODYA-BODY-1x1',
  'the SKU code is UNCHANGED -- it is the permanent reference, not the name'
);

-- ── THE SCREEN READS THE NEW NAME IMMEDIATELY ──────────────────────────────
-- v_skus is what every product list renders from, so this is the check that
-- the rename is actually visible rather than merely stored.
select is(
  (select model_name from v_skus where id = '00000000-0000-0000-0000-000000000214'),
  'Body Butter',
  'every screen reads the corrected name at once, because nothing was copied anywhere'
);

-- ── IT IS RECORDED ─────────────────────────────────────────────────────────
-- A rename rewrites what every past document appears to say. Who changed it,
-- from what, to what, is not optional history.
select is(
  (select old_value || ' -> ' || new_value from audit_log
    where record_id = '00000000-0000-0000-0000-000000000212' and action = 'update'
    order by created_at desc limit 1),
  'Bodymilk -> Body Butter',
  'the change is in the audit log, old and new, in the same transaction'
);

-- ── BRAND AND SIZE TOO ─────────────────────────────────────────────────────
select lives_ok(
  $$select rename_catalogue_part('brand', '00000000-0000-0000-0000-000000000211', 'The Body Shop Audit')$$,
  'a brand can be corrected the same way'
);
select lives_ok(
  $$select rename_catalogue_part('variant', '00000000-0000-0000-0000-000000000213', '200ml')$$,
  'and so can a size label'
);

-- ── TWO BRANDS MAY NOT SHARE A NAME ────────────────────────────────────────
-- Renaming onto an existing brand is a MERGE, which is a different operation
-- with different consequences (every product moves to a brand he did not
-- choose). Refused in words, not as "duplicate key value violates unique
-- constraint" -- the exact class of message that produced "Can't create
-- bodybutter" in migration 0176.
insert into brands (id, name) values ('00000000-0000-0000-0000-000000000218', 'Rival Audit Brand');
select throws_like(
  $$select rename_catalogue_part('brand', '00000000-0000-0000-0000-000000000218', 'The Body Shop Audit')$$,
  '%already a brand called%',
  'renaming onto an existing brand is refused with a sentence, not a constraint name'
);

-- ── A BLANK NAME IS NOT A NAME ─────────────────────────────────────────────
select throws_like(
  $$select rename_catalogue_part('model', '00000000-0000-0000-0000-000000000212', '   ')$$,
  '%cannot be blank%',
  'whitespace is not a name'
);

-- ── ONLY THE RIGHT PEOPLE ──────────────────────────────────────────────────
-- SECURITY DEFINER bypasses the is_admin_or_manager() row policy on these
-- tables, so the function has to reimpose it. A definer function that forgets
-- is how a viewer ends up able to rename the catalogue.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000219', 'test-viewer-rename@example.test');
update user_profiles set role = 'viewer' where id = '00000000-0000-0000-0000-000000000219';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000219', true);
select throws_like(
  $$select rename_catalogue_part('model', '00000000-0000-0000-0000-000000000212', 'Viewer Was Here')$$,
  '%admin or manager%',
  'a viewer cannot rename anything, even though the function runs as its owner'
);

select * from finish();
rollback;

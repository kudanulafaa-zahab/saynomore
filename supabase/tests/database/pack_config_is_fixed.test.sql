-- A pack size is fixed once there is stock against it — and the ledger's
-- sign table cannot drift away from what the ledger accepts.
--
-- WHY THIS FILE EXISTS. One batch in the whole business disagrees with its own
-- product. MAMY-XTRA-XXXL-34x3 says 34 to a pack and 3 packs to a carton — 102.
-- Its only batch recorded 1 carton as 128 pieces, and its stored costs work out
-- at 32 to a pack, 4 packs to a carton. The carton was received, costed and sold
-- as 32x4; the SKU was later re-specced to 34x3; every number already written
-- against it stayed behind.
--
-- Nothing failed. Nothing looked different. The only symptom was a Product Card
-- reporting MVR 245.88 of profit on a carton that really makes MVR 356.41, and
-- MVR 133.97 on a pack that really makes MVR 125.47 — two figures from one
-- batch, wrong in OPPOSITE directions, which is why no one spots this by eye.
--
-- The guard is on the write, not the read. Patching the card would have hidden
-- it: the fault is that a product's pack size can be rewritten underneath the
-- history recorded against it.

begin;
select plan(9);

-- ── The guard ───────────────────────────────────────────────────────────────
do $$
declare
  c uuid; b uuid; m uuid; v uuid; s_clean uuid; s_used uuid; g uuid; batch uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis) values ('PK Cat','pcs','piece') returning id into c;
  insert into brands (name) values ('PKBrand') returning id into b;
  insert into product_models (brand_id, category_id, name) values (b, c, 'PK Model') returning id into m;
  insert into variants (model_id, display_name) values (m, 'PK') returning id into v;

  -- Never received, never sold: still freely editable.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v, 'PK-CLEAN-32x4', 32, 4) returning id into s_clean;

  -- Has a receipt against it: fixed from here on.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v, 'PK-USED-32x4', 32, 4) returning id into s_used;

  select id into g from godowns limit 1;
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_used, g, 1, 128, 10, 320, 1280, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_used, g, 'in', 128, 'adjustment');

  create temp table pk_ids as select s_clean as clean, s_used as used, g as godown;
end $$;

-- THE TYPO PATH MUST SURVIVE. A guard that also blocks fixing a brand-new
-- product's pack size before anything is received would just be an obstacle,
-- and would be worked around by deleting and re-creating the SKU.
select lives_ok(
  $$ update skus set pcs_per_pack = 34, packs_per_carton = 3
      where id = (select clean from pk_ids) $$,
  'a pack size with nothing recorded against it can still be corrected'
);

select is(
  (select pcs_per_pack from skus where id = (select clean from pk_ids)),
  34,
  'and the correction actually took'
);

-- THE REAL GUARD, both columns, independently.
select throws_ok(
  $$ update skus set pcs_per_pack = 34 where id = (select used from pk_ids) $$,
  '23514',
  null,
  'changing pieces-per-pack is refused once stock has been received against it'
);

select throws_ok(
  $$ update skus set packs_per_carton = 3 where id = (select used from pk_ids) $$,
  '23514',
  null,
  'and changing packs-per-carton is refused too — both halves re-cost history'
);

-- IT MUST NOT OVER-BLOCK. If this guard made a SKU read-only, the first person
-- to hit it would disable the trigger, and then it guards nothing.
select lives_ok(
  $$ update skus set supplier_barcode = '999' where id = (select used from pk_ids) $$,
  'every other field on that SKU is still editable'
);

select lives_ok(
  $$ update skus set pcs_per_pack = 32, packs_per_carton = 4 where id = (select used from pk_ids) $$,
  'and writing the SAME pack size back is not a change, so it passes'
);

-- ── The ledger's sign table cannot drift ────────────────────────────────────
-- stock_signed_delta ends in `ELSE 0`, so a movement type it does not recognise
-- contributes NOTHING to stock rather than failing. Today the CHECK constraint
-- and the function agree on all seven types. Nothing keeps them agreeing: add an
-- eighth type to the constraint and forget the function, and that stock silently
-- does not exist. Enumerated from the catalogue so a type added next year is
-- covered without anyone remembering this file.
create temp view pk_allowed_types as
  select m[1] as t
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid,
    lateral regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m
   where c.relname = 'stock_movements'
     and con.conname = 'stock_movements_movement_type_check';

select is(
  (select coalesce(string_agg(t, ', ' order by t), 'none')
     from pk_allowed_types where stock_signed_delta(t, 100) = 0),
  'none',
  'every movement type the ledger ACCEPTS is one stock_signed_delta actually counts'
);

-- The guard is guarding something: "none" above is also the answer if the
-- constraint were dropped and the view returned no rows at all.
select cmp_ok(
  (select count(*)::int from pk_allowed_types),
  '>=', 7,
  'and there really are movement types being checked, not an empty list passing'
);

-- Direction, not just non-zero: an "out" that counted upwards would also be
-- non-zero, and would make every sale increase stock.
select ok(
  stock_signed_delta('in', 100) > 0
  and stock_signed_delta('out', 100) < 0
  and stock_signed_delta('transfer_in', 100) > 0
  and stock_signed_delta('transfer_out', 100) < 0
  and stock_signed_delta('return_in', 100) > 0
  and stock_signed_delta('damage_out', 100) < 0,
  'stock in adds and stock out subtracts — the signs point the right way'
);

select * from finish();
rollback;

-- get_product_card — the fact sheet must agree with the ledger.
--
-- The browser audit checks the screen; this checks the arithmetic, on a fresh
-- database, on every PR touching supabase/. They are peers and neither replaces
-- the other: a UI failure and a maths failure must never be confused.
--
-- The rule this suite exists to protect: THE CARD CALCULATES NOTHING NEW. Every
-- figure must be derivable from rows the rest of the app already reads, and
-- must equal what those rows say. A fact sheet that quietly disagreed with the
-- P&L would be worse than no fact sheet — Ali prices against these numbers.

begin;
select plan(11);

-- ── Fixture ───────────────────────────────────────────────────────────────
-- seed.sql gives the catalogue chain, a godown, a supplier and SKUs.
select is(
  (select count(*) > 0 from public.skus),
  true,
  'the shared fixture has SKUs to card up'
);

-- A confirmed shipment so there is a landed cost to check.
do $$
declare v_sku uuid; v_god uuid; v_sup uuid; v_ship uuid;
begin
  select id into v_sku from public.skus order by internal_code limit 1;
  select id into v_god from public.godowns limit 1;
  select id into v_sup from public.suppliers limit 1;

  -- confirm_grn demands BOTH rates even when every line is USD: it locks the
  -- whole rate set at receipt so a later line in another currency can never be
  -- valued at a rate that was not in force (hard rule 3).
  --
  -- rate_idr_to_mvr is NOT settable — trg_derive_idr_to_mvr computes it from
  -- USD->MVR over USD->IDR and NULLs it when either is missing. Writing it
  -- directly looks like it works and is silently discarded, which is exactly
  -- what happened when this test was first written. Supply the two rates a
  -- person actually types and let the trigger do its job.
  insert into public.shipments (reference, supplier_id, status,
                                rate_usd_to_mvr, rate_usd_to_idr,
                                my_freight_share_usd, customs_duty_mvr, mpl_charges_mvr)
  values ('SH-CARD-TEST', v_sup, 'draft', 15.40, 12000, 100, 0, 200)
  returning id into v_ship;

  insert into public.shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                                     fob_per_carton, fob_currency, destination_godown_id)
  values (v_ship, v_sku, 10, 0.08, 40, 'USD', v_god);

  perform public.confirm_grn(v_ship);
end $$;

-- ── The landed cost must decompose exactly ────────────────────────────────
select is(
  (select round((c->'cost'->>'fob_mvr')::numeric
              + (c->'cost'->>'freight_mvr')::numeric
              + (c->'cost'->>'local_mvr')::numeric
              + (c->'cost'->>'duty_mvr')::numeric, 2)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  (select round((c->'cost'->>'landed_total_mvr')::numeric, 2)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  'supplier price + freight + local + duty equals the landed total, to the laari'
);

select is(
  (select round((c->'cost'->>'landed_total_mvr')::numeric / (c->'cost'->>'qty_cartons')::numeric, 4)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  (select round((c->'cost'->>'per_carton_mvr')::numeric, 4)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  'landed total divided by cartons equals landed per carton'
);

select is(
  (select round((c->'cost'->>'per_carton_mvr')::numeric / (c->'pack'->>'packs_per_carton')::numeric, 4)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  (select round((c->'cost'->>'per_pack_mvr')::numeric, 4)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  'landed per carton divided by packs per carton equals landed per pack'
);

-- ── Margin is GROSS MARGIN, on the selling price ──────────────────────────
-- Markup on cost reads several points higher and is the classic way a product
-- looks healthier than it is. Ali's accountant, bank and suppliers all mean
-- margin, so the card must too (skills.md Seat 4).
do $$
declare v_sku uuid; v jsonb; v_price numeric; v_cost numeric; v_margin numeric;
begin
  select id into v_sku from public.skus order by internal_code limit 1;
  update public.skus set fixed_price_per_pack_mvr = 2000 where id = v_sku;
  v := public.get_product_card(v_sku);
  v_price  := (v->'price'->>'per_pack_mvr')::numeric;
  v_cost   := (v->'price'->>'pack_cost_mvr')::numeric;
  v_margin := (v->'price'->>'pack_margin_pct')::numeric;

  if abs(round((v_price - v_cost) / v_price * 100, 1) - v_margin) > 0.05 then
    raise exception 'margin is not gross margin on the selling price: got %, expected %',
      v_margin, round((v_price - v_cost) / v_price * 100, 1);
  end if;
end $$;
select pass('margin is profit over the SELLING price, never markup on cost');

select is(
  (select round((c->'price'->>'per_pack_mvr')::numeric - (c->'price'->>'pack_cost_mvr')::numeric, 2)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  (select round((c->'price'->>'pack_profit_mvr')::numeric, 2)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  'price minus cost equals the profit shown'
);

-- ── The carton-versus-packs gap is arithmetic, not a slogan ───────────────
select is(
  (select round((c->'price'->>'per_pack_mvr')::numeric * (c->'pack'->>'packs_per_carton')::numeric
              - (c->'price'->>'per_carton_mvr')::numeric, 2)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  (select round((c->'price'->>'carton_discount_mvr')::numeric, 2)
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  'the carton-vs-packs gap is real arithmetic'
);

-- ── Only real sales count ─────────────────────────────────────────────────
-- A draft is not a sale. Counting one would overstate revenue, profit and the
-- customer count on a screen he prices against.
do $$
declare v_sku uuid; v_cust uuid; v_ord uuid; v_before numeric; v_after numeric;
begin
  select id into v_sku from public.skus order by internal_code limit 1;
  select id into v_cust from public.customers limit 1;
  v_before := (public.get_product_card(v_sku)->'sales'->>'revenue_mvr')::numeric;

  insert into public.sales_orders (customer_id, status, order_number)
  values (v_cust, 'draft', 'SO-CARD-DRAFT') returning id into v_ord;
  insert into public.sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (v_ord, v_sku, 'pack', 5, 5 * (select pcs_per_pack from public.skus where id = v_sku), 100, 500);

  v_after := (public.get_product_card(v_sku)->'sales'->>'revenue_mvr')::numeric;
  if v_after <> v_before then
    raise exception 'a DRAFT order changed what the product has earned: % -> %', v_before, v_after;
  end if;
end $$;
select pass('a draft order does not count as something the product has earned');

-- ── Stock agrees with the movement ledger, not a stored number ────────────
select is(
  (select (c->'stock'->>'pieces')::numeric
     from (select public.get_product_card((select id from public.skus order by internal_code limit 1)) as c) x),
  (select coalesce(sum(qty_pieces), 0)::numeric from public.v_stock_levels
     where sku_id = (select id from public.skus order by internal_code limit 1)),
  'stock on the card is the movement ledger, never a stored figure (hard rule 2)'
);

-- ── A product with no arrival yet must not invent a cost ──────────────────
-- The fixture CREATES the never-received SKU rather than hunting for one.
-- The first version searched for a SKU with no confirmed GRN, found none, and
-- printed "skipping" — a test that passes because it did nothing is worse than
-- no test: it reports green for a rule it never exercised.
do $$
declare v_sku uuid; v_var uuid; v jsonb;
begin
  select variant_id into v_var from public.skus limit 1;
  insert into public.skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                           carton_length_cm, carton_width_cm, carton_height_cm)
  values (v_var, 'NEVER-ARRIVED-1x1', 1, 1, 10, 10, 10)
  returning id into v_sku;

  v := public.get_product_card(v_sku);
  if v->'cost' <> 'null'::jsonb then
    raise exception 'a never-received product reported a landed cost: %', v->'cost';
  end if;
  if (v->'stock'->>'pieces')::numeric <> 0 then
    raise exception 'a never-received product reported stock: %', v->'stock';
  end if;
end $$;
select pass('a product that has never arrived reports NO landed cost rather than zero');

-- ── Least privilege (0169's lesson: check the grant, do not assume it) ────
select is(
  (select has_function_privilege('anon', 'public.get_product_card(uuid)', 'execute')),
  false,
  'anon cannot read the product card'
);

select * from finish();
rollback;

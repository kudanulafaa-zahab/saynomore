-- Every pill on the home screen agrees with the screen it opens.
--
-- Ali, 2026-08-30, with a screenshot:
--   *"In today 'needs attention' 2 SKUs out of stock but when I click the pill
--    it takes me to 'stock' module 'on hand' and it doesn't show any SKUs out
--    of stock. Check all pills and functions and make sure everything is
--    accurate. If you show a pill with a function it must always take me to
--    the correct destination."*
--
-- ── WHAT THESE ASSERT, AND WHY IT IS AN INVARIANT AND NOT A NUMBER ─────────
--
-- A pill states a count and links somewhere that lists them. Those are two
-- queries, and nothing but a test stops them drifting apart -- which is
-- precisely what happened: the pill counted get_sku_reorder_alerts() and the
-- destination listed get_reorder_suggestions(), and the second excludes
-- discontinued ranges while the first does not.
--
-- So these do not check that out-of-stock is 2, or 0, or anything. They check
-- that THE TWO SIDES MATCH, whatever the data happens to be. A fixed number
-- would pass on the day it was written and rot the next time Ali sells
-- something.
--
-- ── AND ONE THING THAT IS NOT A COUNTING BUG ──────────────────────────────
--
-- The two SKUs behind the original mismatch were Skin Comfort and Royal Soft
-- Boy: DISCONTINUED lines. CLAUDE.md, 2026-08-14 -- "Never reorder them. They
-- must not appear in reorder suggestions, shipment planning or any 'you are
-- running low' alert. Running low is now the plan." The home screen was
-- reporting the plan working as an emergency and saying "Reorder now". The
-- last test here holds that specific rule.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000008a0', 'test-pills@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000008a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000008a0', true);

-- ══════════════════════════════════════════════════════════════════════════
-- THE INVARIANT: pill = destination, on whatever data exists.
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select out_of_stock_count from get_dashboard_metrics()),
  (select count(*) from get_reorder_suggestions() where status = 'out'),
  'the out-of-stock pill counts exactly what /inventory?filter=out lists'
);

select is(
  (select overstock_sku_count from get_dashboard_metrics()),
  (select count(*) from get_reorder_suggestions() where status = 'overstock'),
  'the overstock pill counts exactly what /inventory?filter=overstock lists'
);

select is(
  (select reorder_needed_count from get_dashboard_metrics()),
  (select count(*) from get_reorder_suggestions() where status in ('critical','low')),
  'the reorder pill counts exactly what /reorder lists'
);

select is(
  (select slow_stock_count from get_dashboard_metrics()),
  (select count(*) from get_promo_suggestions()),
  'the slow-stock pill counts exactly what the Promo Advisor lists'
);

select is(
  (select pending_payments_count from get_dashboard_metrics()),
  (select coalesce(sum(orders_count), 0) from get_receivables_aging()),
  'the unpaid pill counts exactly what the receivables screen totals'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE DAILY LIST STATES MONEY TOO, AND IT MUST BE THE SAME MONEY.
-- ══════════════════════════════════════════════════════════════════════════
-- The deadstock row said "13 products · about MVR 49,408 tied up" while the
-- Needs-Attention card directly beneath it said MVR 44,475 for the same 13.
-- The row was valuing the stock at its PROMO SELLING PRICE while calling it
-- "tied up". Money tied up is what it cost to put there.
-- Compared as NUMBERS after stripping the thousands comma, and both sides fall
-- back to -1 when the row is absent, so a fixture with no slow movers passes on
-- agreement rather than failing on absence. The row is what Ali reads, so the
-- money is pulled back out of the printed sentence rather than recomputed.
select is(
  (select case when exists (select 1 from get_today(20) where kind = 'deadstock')
               then (select replace(substring(detail from 'MVR ([0-9,]+) tied up'), ',', '')::numeric
                       from get_today(20) where kind = 'deadstock')
               else -1 end),
  (select case when exists (select 1 from get_today(20) where kind = 'deadstock')
               then (select round(sum(stock_value_mvr)) from get_promo_suggestions())
               else -1 end),
  'the daily list quotes the same money tied up as the screen it opens'
);

select is(
  (select case when exists (select 1 from get_today(20) where kind = 'deadstock')
               then (select substring(detail from '^([0-9]+) product')::int
                       from get_today(20) where kind = 'deadstock')
               else -1 end),
  (select case when exists (select 1 from get_today(20) where kind = 'deadstock')
               then (select count(*)::int from get_promo_suggestions())
               else -1 end),
  'and the same number of products'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE RULE: a discontinued range that has run out is the PLAN, not an alert.
-- ══════════════════════════════════════════════════════════════════════════
-- Built so it would be counted under the old source: real sales inside the
-- 30-day window, and nothing left on the shelf. The only thing keeping it out
-- of the count is that its model is discontinued.
insert into product_models (id, brand_id, category_id, name, discontinued_at)
values ('00000000-0000-0000-0000-0000000008b0',
        (select id from brands limit 1),
        (select id from product_categories limit 1),
        'Test Dropped Range', (now() - interval '10 days')::date);

insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008b0',
        'Dropped L', '{"size":"L-dropped"}'::jsonb);

insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000008b2', '00000000-0000-0000-0000-0000000008b1',
        'TEST-DROPPED-10x2', 10, 2, 40, 30, 30, 200, array['pack']);

-- In, then all of it out as sales inside the 30-day window: sells, and is now
-- empty. Exactly the shape that reads as "out of stock, losing sales".
insert into inventory_batches (id, sku_id, godown_id, received_at, source,
                               qty_cartons_received, qty_pieces_received, landed_per_piece_mvr,
                               landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000008b3', '00000000-0000-0000-0000-0000000008b2',
        '00000000-0000-0000-0000-000000000006', now() - interval '20 days', 'direct',
        1, 200, 10, 100, 200);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
values ('00000000-0000-0000-0000-0000000008b3', '00000000-0000-0000-0000-0000000008b2',
        '00000000-0000-0000-0000-000000000006', 'in', 200, 'direct_receipt', now() - interval '20 days'),
       ('00000000-0000-0000-0000-0000000008b3', '00000000-0000-0000-0000-0000000008b2',
        '00000000-0000-0000-0000-000000000006', 'out', 200, 'sales_order', now() - interval '5 days');

-- It genuinely looks out of stock to the alert engine...
select is(
  (select alert_level from get_sku_reorder_alerts()
    where sku_id = '00000000-0000-0000-0000-0000000008b2'),
  'out',
  'the raw alert engine does see the dropped range as out of stock'
);

-- ...and the home screen must still not say so, because he stopped buying it
-- on purpose and "reorder now" is the one thing he must not be told.
select is(
  (select count(*) from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-0000000008b2'),
  0::bigint,
  'but a discontinued range never reaches the pill -- running out of it IS the plan'
);

select * from finish();
rollback;

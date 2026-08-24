-- Pass 22: a giveaway is marketing at cost. Not a sale, not a loss.
-- Regression guard for migration 0206.
--
-- Ali, 2026-08-24: *"I launched an Instagram giveaway promotion for a case of
-- diapers. Now I have chosen a winner... Since it's not a sale I will still have
-- to enter it to the system and deduct from stock. Where will it go into the
-- system and what's the best way professionals do it?"*
--
-- ── WHAT THIS FILE IS REALLY GUARDING ───────────────────────────────────────
--
-- Not "does stock go down" — that is one loop. The reason a giveaway is worth a
-- test file is that it must land in exactly ONE place and be absent from three
-- others, and every one of those absences is silent when it breaks:
--
--   IT MUST BE          marketing spend, at LANDED COST, on the named campaign
--   IT MUST NOT BE      revenue, or any part of COGS
--   IT MUST NOT BE      the P&L's write-off line, which signals SHRINKAGE
--   IT MUST NOT BE      demand — a prize is not a customer wanting something,
--                       and counting it would push the reorder engine to buy
--                       more of a product nobody actually asked for
--
-- ── AND THE SILENT FAILURE THE DESIGN AVOIDS ────────────────────────────────
--
-- `stock_signed_delta` ends in `ELSE 0`. A NEW movement_type for giveaways
-- would fall through it and count as no movement at all: the marketing cost
-- would post, the screen would say it worked, and the stock would never go
-- down — found weeks later at a stock count. So giveaways reuse
-- movement_type = 'out' (already signed negative) and carry the new value on
-- `source_type`, where nothing computes with it. Test 2 is that guarantee.

begin;
select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000220', 'test-giveaway@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000220';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000220', true);

-- A carton of diapers: 4 packs of 48, landed at MVR 5 a piece, so the whole
-- carton cost MVR 960. That is the number the campaign must be charged.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000221', 'SH-TEST-GIVEAWAY',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000004',
        'TEST-GIVEAWAY-48x4', 48, 4, 40, 30, 30, 400, 1560, array['pack','carton']);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000223', '00000000-0000-0000-0000-000000000221',
        '00000000-0000-0000-0000-000000000222', 2, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000224', '00000000-0000-0000-0000-000000000223',
        '00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days', 2, 384, 5.00, 240.00, 960.00);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000224', '00000000-0000-0000-0000-000000000222',
        '00000000-0000-0000-0000-000000000006', 'in', 384, 'shipment');

-- ── IT COSTS WHAT IT COST, NOT WHAT IT SELLS FOR ───────────────────────────
-- One carton = 192 pieces at MVR 5 landed = MVR 960. The carton SELLS for
-- MVR 1,560 — and booking that figure would invent a MVR 600 loss that never
-- happened. This is the single most important number in the file.
select is(
  give_away_stock('00000000-0000-0000-0000-000000000222',
                  '00000000-0000-0000-0000-000000000006',
                  192, 'Instagram giveaway August'),
  960.00::numeric,
  'the prize is costed at what it LANDED at (MVR 960), never at the MVR 1,560 it sells for -- that revenue never existed'
);

-- ── THE STOCK ACTUALLY LEFT ────────────────────────────────────────────────
-- The silent-failure guard. A new movement_type would fall through
-- stock_signed_delta's ELSE 0 and this would still read 384.
select is(
  (select sum(stock_signed_delta(movement_type, qty_pieces))::int
     from stock_movements where sku_id = '00000000-0000-0000-0000-000000000222'),
  192,
  'and the stock really went down -- a new movement type would have fallen through stock_signed_delta and deducted nothing'
);

-- ── IT IS MARKETING, ON THE NAMED CAMPAIGN ─────────────────────────────────
select is(
  (select round(amount_mvr, 2) from marketing_spend
    where campaign_name = 'Instagram giveaway August'),
  960.00::numeric,
  'the cost is charged to the campaign as marketing spend'
);
select is(
  (select channel from marketing_spend where campaign_name = 'Instagram giveaway August'),
  'giveaway',
  'marked as GOODS, not a boost -- money that left the bank and stock that left the godown are different costs of the same campaign'
);
select is(
  (select count(*)::int from marketing_spend_skus mss
     join marketing_spend ms on ms.id = mss.spend_id
    where ms.campaign_name = 'Instagram giveaway August'
      and mss.sku_id = '00000000-0000-0000-0000-000000000222'),
  1,
  'and linked to the product, so campaign ROI measures it against sales of that product'
);

-- ── IT IS NOT REVENUE, AND NOT COGS ────────────────────────────────────────
-- A sale at MVR 0 was the tempting shortcut. It would have put the winner in
-- customer history (so the follow-up round chases them), dropped average order
-- value, and shown COGS with no revenue.
select is(
  (select revenue_mvr from get_pnl(
     (now() at time zone 'Indian/Maldives')::date,
     (now() at time zone 'Indian/Maldives')::date)),
  0::numeric,
  'no revenue was invented -- a giveaway earns nothing and must not pretend to'
);
select is(
  (select cogs_mvr from get_pnl(
     (now() at time zone 'Indian/Maldives')::date,
     (now() at time zone 'Indian/Maldives')::date)),
  0::numeric,
  'and no COGS -- cost of goods SOLD is for goods that were sold'
);
select is(
  (select count(*)::int from sales_orders so
     join sales_order_lines sol on sol.order_id = so.id
    where sol.sku_id = '00000000-0000-0000-0000-000000000222'),
  0,
  'no order and no customer were created -- the winner is not a buyer, and the follow-up round must not chase them'
);

-- ── IT IS NOT A WRITE-OFF ──────────────────────────────────────────────────
-- The P&L's write-off line signals SHRINKAGE: damage, expiry, theft. Mixing
-- promotions into it means a rise next month cannot distinguish a storage
-- problem from a campaign.
select is(
  (select stock_writeoff_mvr from get_pnl(
     (now() at time zone 'Indian/Maldives')::date,
     (now() at time zone 'Indian/Maldives')::date)),
  0::numeric,
  'the write-off line is untouched -- it means shrinkage, and this was a decision'
);
select is(
  (select marketing_mvr from get_pnl(
     (now() at time zone 'Indian/Maldives')::date,
     (now() at time zone 'Indian/Maldives')::date)),
  960.00::numeric,
  'the cost appears EXACTLY ONCE in the P&L, as marketing'
);

-- ── A PROMOTION NOBODY NAMED IS INDISTINGUISHABLE FROM MISSING STOCK ───────
select throws_like(
  $$select give_away_stock('00000000-0000-0000-0000-000000000222',
                           '00000000-0000-0000-0000-000000000006', 48, '   ')$$,
  '%which promotion%',
  'a giveaway must name its campaign -- otherwise the cost can never be measured against what it earned'
);

-- ── YOU CANNOT GIVE AWAY WHAT YOU DO NOT HAVE ──────────────────────────────
select throws_like(
  $$select give_away_stock('00000000-0000-0000-0000-000000000222',
                           '00000000-0000-0000-0000-000000000006', 9999, 'Too generous')$$,
  '%on hand%',
  'and cannot issue more than the godown holds'
);

select * from finish();
rollback;

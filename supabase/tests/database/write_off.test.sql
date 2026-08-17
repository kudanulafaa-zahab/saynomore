-- Damaged, expired, lost — the stock that leaves without being sold.
--
-- Ali, 2026-08-17, asking for the whole surface to be re-checked after a run of
-- changes: *"Make sure everything is intact and works as before. Money math,
-- arithmetic, stock options including call back, returns, damage etc."*
--
-- Returns had four test files. Write-offs had ONE line, and it tested the
-- arithmetic helper (`stock_signed_delta('damage_out', 10) = -10`) rather than
-- the RPC anyone actually calls. So the path from "a carton got crushed in the
-- godown" to "the month's profit is lower by what it cost" was never checked
-- end to end.
--
-- That gap matters more than it looks. A write-off is the one stock movement
-- with NO revenue beside it: every piece of it is a loss, and it is valued at
-- the batch's locked landed cost, so getting it wrong moves the P&L in a
-- direction nothing else corrects. A sale that deducts the wrong stock shows up
-- as a margin oddity; a write-off that does not reach the P&L simply never
-- happened as far as the accounts are concerned.
--
-- Two batches at DIFFERENT costs on purpose. A write-off depletes oldest-first
-- and values each piece at the cost of the batch it came from — the same money
-- trail a sale leaves. With one batch the FIFO order is unobservable and the
-- valuation cannot be told apart from a flat average.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f0', 'test-writeoff@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000f0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', true);

-- Older batch: 100 pieces at MVR 10. Newer: 100 pieces at MVR 25.
insert into inventory_batches (id, sku_id, godown_id, received_at, qty_cartons_received,
                               qty_pieces_received, landed_per_piece_mvr, landed_per_pack_mvr,
                               landed_per_carton_mvr, source)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', now() - interval '30 days', 1, 100, 10, 340, 1020, 'direct'),
       ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', now() - interval '2 days',  1, 100, 25, 850, 2550, 'direct');
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 100, 'direct_receipt'),
       ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 100, 'direct_receipt');

-- ── It refuses what is not there ───────────────────────────────────────────
-- Before anything else, because a write-off that can go negative is a hole in
-- the ledger: stock is SUM(movements), so nothing else would notice.
select throws_like(
  $$select write_off_stock('00000000-0000-0000-0000-000000000005'::uuid,
      '00000000-0000-0000-0000-000000000006'::uuid, 500, 'damaged', null)$$,
  '%on hand%',
  'you cannot write off more than is on the shelf, and it says how much there is'
);

select throws_like(
  $$select write_off_stock('00000000-0000-0000-0000-000000000005'::uuid,
      '00000000-0000-0000-0000-000000000006'::uuid, 10, 'because', null)$$,
  '%Invalid write-off reason%',
  'and every write-off has to say WHY — damaged, expired, lost or other'
);

-- ── The loss is valued at the cost of the stock that actually left ─────────
-- 120 pieces: all 100 of the old batch at MVR 10, then 20 of the new at MVR 25.
-- 1,000 + 500 = MVR 1,500. A flat average would have said 120 × 17.50 = 2,100.
select is(
  (select write_off_stock('00000000-0000-0000-0000-000000000005'::uuid,
     '00000000-0000-0000-0000-000000000006'::uuid, 120, 'damaged', 'crushed in the godown')),
  1500.00::numeric,
  'the loss is the OLDEST stock first, at the cost each batch actually landed at'
);

select is(
  (select coalesce(sum(public.stock_signed_delta(movement_type, qty_pieces)), 0)::int
     from stock_movements
    where sku_id = '00000000-0000-0000-0000-000000000005'
      and godown_id = '00000000-0000-0000-0000-000000000006'),
  80,
  'and the shelf is lighter by exactly that much'
);

select is(
  (select coalesce(sum(qty_pieces), 0)::int from stock_movements
    where movement_type = 'damage_out' and source_type = 'damage'
      and sku_id = '00000000-0000-0000-0000-000000000005'),
  120,
  'recorded as a damage movement, not disguised as a sale'
);

-- The old batch is emptied, not part-drawn — proof the FIFO walk really
-- crossed a batch boundary rather than taking 120 from one of them.
select is(
  (select coalesce(sum(public.stock_signed_delta(movement_type, qty_pieces)), 0)::int
     from stock_movements where batch_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'the oldest batch is emptied before the newer one is touched'
);

-- ── It reaches the money ───────────────────────────────────────────────────
-- The check that was missing. A write-off has no revenue beside it, so if the
-- P&L does not see it, the loss simply never happened in the accounts.
select is(
  (select stock_writeoff_mvr from get_pnl(
     (now() at time zone 'Indian/Maldives')::date,
     (now() at time zone 'Indian/Maldives')::date + 1)),
  1500.00::numeric,
  'and the P&L carries the loss, to the rufiyaa'
);

-- ── It leaves a trail ──────────────────────────────────────────────────────
select is(
  (select count(*)::int from audit_log
    where action = 'write_off' and record_id = '00000000-0000-0000-0000-000000000005'),
  1,
  'with an audit row saying what was on hand before and after'
);

-- ── Least privilege ────────────────────────────────────────────────────────
select is(
  (select has_function_privilege('anon', 'public.write_off_stock(uuid,uuid,integer,text,text)', 'execute')),
  false,
  'and nobody can write off stock without signing in'
);

select * from finish();
rollback;

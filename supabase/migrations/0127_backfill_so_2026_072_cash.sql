-- 0127 — Backfill cash_collected_mvr for SO-2026-072.
--
-- Found during the audit: this order was marked "deposited" (COD cash
-- collected AND banked) with no cash_collected_mvr ever recorded — the
-- deposit action didn't require an amount, so there was no traceable
-- record of what was actually collected (fixed going forward in the same
-- audit: dispatch-view.tsx's delivery confirmation now requires the amount
-- for COD orders, and sale-detail.tsx won't offer "Mark Cash Deposited"
-- without one).
--
-- Ali confirmed directly: yes, MVR 776 was actually collected by Ibrahim
-- and deposited for this order. Backfilling the real figure now that it's
-- a confirmed fact, not a guess.

update sales_orders
set cash_collected_mvr = 776
where order_number = 'SO-2026-072'
  and cash_collected_mvr is null;

insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
select 'sales_orders', id, 'update', 'cash_collected_mvr', 'null', '776',
       'Backfill (migration 0127): Ali confirmed MVR 776 was actually collected by Ibrahim and deposited for this order on 2026-08-02 — the amount was never recorded at the time because the deposit action did not require it (root cause fixed in migration 0121''s audit).',
       null
from sales_orders where order_number = 'SO-2026-072';

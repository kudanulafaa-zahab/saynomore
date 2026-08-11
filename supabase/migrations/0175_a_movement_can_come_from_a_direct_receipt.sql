-- 0175 — a movement can come from a direct receipt.
--
-- stock_movements.source_type allowed shipment / sales_order / transfer /
-- adjustment / return / damage. A direct receipt is none of those.
--
-- It gets its OWN value rather than borrowing 'shipment' or hiding inside
-- 'adjustment'. Both alternatives were considered and rejected:
--
--   'shipment'   would make a suitcase indistinguishable from a container in
--                every receiving report, and could draw these movements into
--                GRN void logic that has no batch line to reverse.
--   'adjustment' is a CORRECTION to a count, not an arrival. Filing a purchase
--                there loses the fact that stock genuinely entered the
--                business, and muddies the one bucket used for stock-count
--                fixes.
--
-- A new arrival type is the honest answer, and the CHECK is what forced the
-- question to be asked at all.

alter table stock_movements drop constraint if exists stock_movements_source_type_check;

alter table stock_movements add constraint stock_movements_source_type_check
  check (source_type = any (array[
    'shipment','sales_order','transfer','adjustment','return','damage',
    'direct_receipt'
  ]));

comment on column stock_movements.source_type is
  'What caused this movement. direct_receipt = stock bought locally or carried '
  'in, with no shipment behind it; source_id points at the batch itself.';

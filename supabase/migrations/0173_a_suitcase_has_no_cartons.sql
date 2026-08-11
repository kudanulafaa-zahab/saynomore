-- 0173 — a suitcase has no cartons.
--
-- inventory_batches.qty_cartons_received had CHECK (> 0), which is right for a
-- container: a shipment line always arrives as some whole number of cartons.
--
-- A direct receipt has none. Twenty-four tubs carried home in a suitcase were
-- never in a carton, and there is no honest integer to write there:
--
--   * 0 is the truth, and the old constraint refused it;
--   * 24 would be a lie that shows up as phantom cartons in receiving reports;
--   * pieces / (pcs_per_pack * packs_per_carton) is fractional for most SKUs
--     (10 packs of a 48x4 diaper is 2.5 cartons) and the column is an integer.
--
-- So the constraint becomes >= 0, and only for the direct case: a shipment
-- batch must STILL bring at least one carton, because a container line with no
-- cartons is a real data error and this check is the thing that catches it.
--
-- qty_pieces_received keeps its > 0 rule untouched — a receipt of nothing is
-- meaningless whichever door it came through.

alter table inventory_batches drop constraint if exists inventory_batches_qty_cartons_received_check;

alter table inventory_batches add constraint inventory_batches_qty_cartons_received_check
  check (
    (source = 'shipment' and qty_cartons_received > 0)
    or
    (source = 'direct'   and qty_cartons_received >= 0)
  );

comment on column inventory_batches.qty_cartons_received is
  'Cartons that physically arrived. Always > 0 for a shipment; always 0 for a '
  'direct receipt, which never travelled in a carton. Read qty_pieces_received '
  'for the quantity that matters.';

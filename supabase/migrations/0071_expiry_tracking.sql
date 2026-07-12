-- 0071: Expiry tracking (FMCG: diapers/consumables expire).
-- Capture expiry per shipment line at GRN; batches inherit it via trigger
-- (no change to confirm_grn itself). v_expiring_stock powers alerts.
-- NOTE: stock depletion stays FIFO (received-order) for now — switching the
-- sale engine to FEFO (first-expiry-first-out) is a deliberate later step
-- once expiry data has actually been captured for a few shipments.
ALTER TABLE shipment_lines    ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS expiry_date date;

CREATE OR REPLACE FUNCTION public.inherit_batch_expiry()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.expiry_date IS NULL AND NEW.shipment_line_id IS NOT NULL THEN
    SELECT sl.expiry_date INTO NEW.expiry_date
    FROM shipment_lines sl WHERE sl.id = NEW.shipment_line_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inherit_batch_expiry ON inventory_batches;
CREATE TRIGGER trg_inherit_batch_expiry
  BEFORE INSERT ON inventory_batches
  FOR EACH ROW EXECUTE FUNCTION public.inherit_batch_expiry();

-- Stock that expires within 120 days (or already expired), with value at cost.
CREATE OR REPLACE VIEW public.v_expiring_stock AS
SELECT
  bs.sku_id,
  b.expiry_date,
  (b.expiry_date - CURRENT_DATE) AS days_left,
  SUM(bs.qty_pieces_remaining)   AS pieces,
  ROUND(SUM(bs.qty_pieces_remaining * COALESCE(bs.landed_per_piece_mvr, 0)), 2) AS value_mvr
FROM v_batch_stock bs
JOIN inventory_batches b ON b.id = bs.batch_id
WHERE b.expiry_date IS NOT NULL
  AND bs.qty_pieces_remaining > 0
  AND b.expiry_date <= CURRENT_DATE + 120
GROUP BY bs.sku_id, b.expiry_date;

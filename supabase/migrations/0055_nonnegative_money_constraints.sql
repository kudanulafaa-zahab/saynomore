-- ── Migration 0055: the database refuses negative money ──
--
-- World-class audit finding A3: every shipment cost field accepted
-- negative numbers end-to-end (no CHECK constraints, no input mins).
-- A stray minus sign on customs duty would silently DEFLATE landed cost
-- and inflate every margin downstream — permanently locked in at GRN.
--
-- Frontend gets friendly validation separately; these constraints are
-- the backstop that makes corrupt money impossible regardless of which
-- screen (or future bug) writes it. Existing data verified clean via
-- dry-run before applying.

BEGIN;

ALTER TABLE shipments
  ADD CONSTRAINT ship_freight_share_nonneg   CHECK (my_freight_share_usd >= 0),
  ADD CONSTRAINT ship_customs_nonneg         CHECK (customs_duty_mvr    >= 0),
  ADD CONSTRAINT ship_mpl_nonneg             CHECK (mpl_charges_mvr     >= 0),
  ADD CONSTRAINT ship_agent_nonneg           CHECK (agent_fee_mvr       >= 0),
  ADD CONSTRAINT ship_lastmile_nonneg        CHECK (last_mile_mvr       >= 0),
  ADD CONSTRAINT ship_insurance_nonneg       CHECK (insurance_mvr       >= 0),
  ADD CONSTRAINT ship_other_nonneg           CHECK (other_mvr           >= 0),
  ADD CONSTRAINT ship_container_freight_nonneg
    CHECK (total_container_freight_usd IS NULL OR total_container_freight_usd >= 0);

ALTER TABLE shipment_lines
  ADD CONSTRAINT sl_fob_nonneg          CHECK (fob_per_carton >= 0),
  ADD CONSTRAINT sl_qty_positive        CHECK (qty_cartons > 0),
  ADD CONSTRAINT sl_qty_actual_nonneg   CHECK (qty_cartons_actual IS NULL OR qty_cartons_actual >= 0);

ALTER TABLE sales_order_lines
  ADD CONSTRAINT sol_price_nonneg       CHECK (unit_price_mvr >= 0),
  ADD CONSTRAINT sol_qty_positive       CHECK (qty_pieces > 0),
  ADD CONSTRAINT sol_total_nonneg       CHECK (line_total_mvr >= 0);

COMMIT;

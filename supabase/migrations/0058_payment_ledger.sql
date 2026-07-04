-- ── Migration 0058: partial-payment ledger + derived payment status ──
--
-- PROBLEM: sales_orders.payment_status allowed 'partial' but nothing ever
-- set it. A credit customer paying an order in instalments could not be
-- tracked — cash_collected_mvr was a single all-or-nothing number, and
-- sale-detail's "Mark paid" flipped straight from pending → paid. There
-- was no record of HOW MUCH was paid, WHEN, or by what METHOD.
--
-- DOCTRINE (pricing-sales-expert AR rules): never store just the result —
-- store the source records and derive the status. So:
--
--  (1) order_payments LEDGER. One row per money movement against an order
--      (a transfer, a cash instalment, a COD collection, a refund). This is
--      the record of truth for "how much has this order been paid".
--        - amount_mvr may be NEGATIVE (a refund / reversal) so returns are
--          auditable rather than deleted; it may not be zero.
--        - a per-order guard stops total paid going below zero.
--
--  (2) DERIVED STATUS, trigger-synced. payment_status stays a STORED column
--      (the sales list filters unpaid orders — it must be indexable/fast),
--      but is kept in sync by a trigger off the ledger:
--          paid  = 0        → 'pending'   (unpaid)
--          0 < paid < total → 'partial'
--          paid >= total    → 'paid'      (overpay caps at 'paid' → credit)
--      COD-managed states ('cod','deposited') are the driver-cash banking
--      layer (collected vs banked) and are NOT overridden here, so the COD
--      reconciliation view keeps its own meaning. Recording a COD collection
--      as a ledger row is optional and does not fight that layer.
--
--  (3) v_order_balances VIEW. order_total / paid / balance / derived status
--      per order, for the record-payment sheet and the unpaid filter.
--
-- Money math stays in Postgres (hard rule 1). No TypeScript arithmetic.

BEGIN;

-- ── (1) The ledger ─────────────────────────────────────────────────────────
CREATE TABLE order_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  amount_mvr   numeric NOT NULL CHECK (amount_mvr <> 0),
  method       text NOT NULL DEFAULT 'transfer'
                 CHECK (method IN ('cash','transfer','cod','card','other')),
  paid_at      timestamptz NOT NULL DEFAULT now(),
  reference    text,
  note         text,
  is_reversal  boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES user_profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_payments_order ON order_payments(order_id);

COMMENT ON TABLE order_payments IS
  'Payment ledger: one row per money movement against a sales order. Negative amount = refund/reversal. payment_status on sales_orders is derived from the sum of these rows.';

-- ── (2) Total-paid can never go negative (reversals cannot overshoot) ───────
CREATE OR REPLACE FUNCTION guard_order_payment_nonnegative()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_total numeric;
  v_order uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  SELECT COALESCE(SUM(amount_mvr), 0) INTO v_total
  FROM order_payments WHERE order_id = v_order;
  IF v_total < -0.005 THEN
    RAISE EXCEPTION 'This would make total paid negative (MVR %) — a refund cannot exceed what was paid on this order', ROUND(v_total, 2);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_order_payment_nonnegative
  AFTER INSERT OR UPDATE OR DELETE ON order_payments
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION guard_order_payment_nonnegative();

-- ── (3) Derive & sync sales_orders.payment_status from the ledger ──────────
CREATE OR REPLACE FUNCTION sync_order_payment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_order uuid := COALESCE(NEW.order_id, OLD.order_id);
  v_paid  numeric;
  v_total numeric;
  v_cur   text;
BEGIN
  SELECT payment_status INTO v_cur FROM sales_orders WHERE id = v_order;

  -- Leave COD banking states alone — that's the driver-cash reconciliation
  -- layer, not the order-balance layer.
  IF v_cur IN ('cod','deposited') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(amount_mvr), 0) INTO v_paid
  FROM order_payments WHERE order_id = v_order;

  SELECT COALESCE(SUM(line_total_mvr), 0) INTO v_total
  FROM sales_order_lines WHERE order_id = v_order;

  UPDATE sales_orders SET payment_status =
    CASE
      WHEN v_paid <= 0.005              THEN 'pending'
      WHEN v_paid >= v_total - 0.005    THEN 'paid'
      ELSE                                   'partial'
    END,
    updated_at = now()
  WHERE id = v_order;

  RETURN NULL;
END $$;

CREATE TRIGGER trg_sync_order_payment_status
  AFTER INSERT OR UPDATE OR DELETE ON order_payments
  FOR EACH ROW EXECUTE FUNCTION sync_order_payment_status();

-- ── (4) Balances view (order_total / paid / balance / derived status) ──────
CREATE OR REPLACE VIEW v_order_balances
WITH (security_invoker = true) AS
SELECT
  so.id                                             AS order_id,
  so.order_number,
  so.customer_id,
  so.payment_status,
  so.payment_method,
  COALESCE(lt.order_total, 0)                       AS order_total_mvr,
  COALESCE(pd.paid, 0)                              AS paid_mvr,
  ROUND(COALESCE(lt.order_total, 0) - COALESCE(pd.paid, 0), 2) AS balance_mvr,
  pd.last_paid_at,
  pd.payment_count
FROM sales_orders so
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(line_total_mvr), 0) AS order_total
  FROM sales_order_lines WHERE order_id = so.id
) lt ON true
LEFT JOIN LATERAL (
  SELECT SUM(amount_mvr) AS paid,
         MAX(paid_at)     AS last_paid_at,
         COUNT(*)         AS payment_count
  FROM order_payments WHERE order_id = so.id
) pd ON true;

-- ── (5) Record-payment RPC (single entry point; money math in Postgres) ────
CREATE OR REPLACE FUNCTION record_order_payment(
  p_order_id   uuid,
  p_amount_mvr numeric,
  p_method     text DEFAULT 'transfer',
  p_paid_at    timestamptz DEFAULT now(),
  p_reference  text DEFAULT NULL,
  p_note       text DEFAULT NULL
) RETURNS order_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row order_payments;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only an admin or manager can record a payment';
  END IF;
  IF p_amount_mvr = 0 THEN
    RAISE EXCEPTION 'Payment amount cannot be zero';
  END IF;

  INSERT INTO order_payments (order_id, amount_mvr, method, paid_at, reference, note, is_reversal, created_by)
  VALUES (p_order_id, p_amount_mvr, COALESCE(p_method,'transfer'), COALESCE(p_paid_at, now()),
          p_reference, p_note, p_amount_mvr < 0, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- ── (6) RLS — authed read, admin/manager write (matches app posture) ───────
ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_payments_read ON order_payments
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY order_payments_write ON order_payments
  FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

REVOKE ALL ON order_payments FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_payments TO authenticated;
REVOKE ALL ON FUNCTION record_order_payment(uuid, numeric, text, timestamptz, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION record_order_payment(uuid, numeric, text, timestamptz, text, text) TO authenticated;
REVOKE ALL ON v_order_balances FROM anon, PUBLIC;
GRANT SELECT ON v_order_balances TO authenticated;

COMMIT;

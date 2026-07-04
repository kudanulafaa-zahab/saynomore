-- ── Migration 0059: Multi-godown stock transfers + physical verification ─────
--
-- Two real-world warehouse needs, both riding on the existing single ledger
-- (stock_movements) so on-hand stays = SUM(signed movements) everywhere. No
-- number is ever stored directly; nothing here touches forex or landed-cost math.
--
--  (1) STOCK TRANSFER (deliberate move godown A → godown B).
--      A batch is UNIQUE per shipment_line (inventory_batches_one_per_line) and
--      carries ONE landed cost, so we do NOT clone batches across godowns. Instead a
--      transfer is a pair of movements on the SAME batch: 'transfer_out' tagged with
--      godown A and 'transfer_in' tagged with godown B. Because every stock view keys
--      location off the MOVEMENT's godown_id (not the batch's home godown — see the
--      v_batch_stock redefinition below), the pieces correctly leave A and appear in
--      B while keeping their exact cost basis (it's literally the same batch row).
--      FIFO: source batches drain oldest received_at first, matching sales depletion.
--
--  (2) PHYSICAL VERIFICATION (next-day count vs system).
--      Delivery staff stack goods arbitrarily; the next day someone counts what
--      actually landed in each godown. The app already knows the SYSTEM figure
--      (v_stock_levels), so the count sheet is PRE-FILLED — the verifier only types
--      the lines that are WRONG. On submit we:
--        • create a stock_verification_sessions row (the count event, per godown)
--        • record every submitted line (expected vs counted vs signed delta + reason)
--        • write ONE 'adjustment' movement per DISCREPANT line so on-hand snaps to
--          the physical truth. Matching lines write nothing (audit still records them).
--      Shrinkage (counted < system) drains oldest batches FIFO (matches sales).
--      Surplus (counted > system) lands on the newest batch's cost (safest guess —
--      we can't invent a landed cost, so reuse the most recent known one).
--
-- All write RPCs are admin/manager only (is_admin_or_manager), SECURITY DEFINER,
-- search_path pinned — consistent with confirm_grn / post_sale / record_order_payment.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- (0) Make v_batch_stock godown-aware so transfers/verification are location-true
-- ══════════════════════════════════════════════════════════════════════════════
-- Original view grouped by batch only and reported b.godown_id (the batch's HOME
-- godown). Once a batch's pieces can move between godowns, remaining-on-hand must be
-- computed PER (batch, movement godown) — otherwise transferred-in stock would still
-- look like it's sittin in the source godown, and post_sale (which filters this view
-- by godown_id) could sell pieces that have physically moved away.
--
-- New grouping key: (batch_id, sm.godown_id). A partially-transferred batch now shows
-- as two rows (one per godown), each with its true remaining. Sum-per-SKU is unchanged
-- (A-remaining + B-remaining = total); cost-per-batch is unchanged (same landed cost on
-- both rows). All existing callers stay correct; post_sale gets more accurate.
DROP VIEW IF EXISTS v_batch_stock CASCADE;
CREATE VIEW v_batch_stock
WITH (security_invoker = true) AS
SELECT
  b.id                    AS batch_id,
  b.sku_id,
  sm.godown_id,                              -- location of THIS remaining, not batch home
  b.received_at,
  b.landed_per_piece_mvr,
  COALESCE(SUM(
    CASE sm.movement_type
      WHEN 'in'           THEN  sm.qty_pieces
      WHEN 'transfer_in'  THEN  sm.qty_pieces
      WHEN 'return_in'    THEN  sm.qty_pieces
      WHEN 'adjustment'   THEN  sm.qty_pieces
      WHEN 'out'          THEN -sm.qty_pieces
      WHEN 'transfer_out' THEN -sm.qty_pieces
      WHEN 'damage_out'   THEN -sm.qty_pieces
    END
  ), 0)::INTEGER          AS qty_pieces_remaining
FROM inventory_batches b
JOIN stock_movements sm ON sm.batch_id = b.id  -- INNER: a batch only exists via its 'in' movement
GROUP BY b.id, sm.godown_id;

GRANT SELECT ON v_batch_stock TO authenticated;
REVOKE SELECT ON v_batch_stock FROM anon;

-- v_skus depends on v_batch_stock (latest-landed CTE), so DROP ... CASCADE above
-- removes it too. Recreate it verbatim from its live definition (migration 0043,
-- unchanged since) with the 0053 security_invoker hardening. NOTE: the column set
-- and rounding are identical to 0043 — this is a pure restore, not a redefinition.
CREATE VIEW v_skus
WITH (security_invoker = true) AS
WITH latest_landed AS (
  SELECT DISTINCT ON (v_batch_stock.sku_id) v_batch_stock.sku_id,
    v_batch_stock.landed_per_piece_mvr
  FROM v_batch_stock
  WHERE v_batch_stock.qty_pieces_remaining > 0
  ORDER BY v_batch_stock.sku_id, v_batch_stock.received_at DESC
)
SELECT s.id,
  s.variant_id, s.internal_code, s.supplier_barcode,
  s.pcs_per_pack, s.packs_per_carton,
  s.pcs_per_pack * s.packs_per_carton AS pcs_per_carton,
  s.carton_length_cm, s.carton_width_cm, s.carton_height_cm, s.carton_weight_kg,
  s.cbm_per_carton, s.is_active, s.notes, s.created_at, s.updated_at,
  s.target_margin_pct, s.fixed_selling_price_mvr,
  s.fixed_price_per_pack_mvr, s.fixed_price_per_carton_mvr,
  ll.landed_per_piece_mvr,
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN ROUND(s.fixed_selling_price_mvr, 0)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr / (1::numeric - s.target_margin_pct / 100.0), 0)
    ELSE NULL::numeric
  END AS selling_price_per_piece_mvr,
  CASE
    WHEN s.fixed_price_per_pack_mvr IS NOT NULL THEN ROUND(s.fixed_price_per_pack_mvr, 0)
    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
    ELSE NULL::numeric
  END AS selling_price_per_pack_mvr,
  CASE
    WHEN s.fixed_price_per_carton_mvr IS NOT NULL THEN ROUND(s.fixed_price_per_carton_mvr, 0)
    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
    ELSE NULL::numeric
  END AS selling_price_per_carton_mvr,
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL AND ll.landed_per_piece_mvr > 0::numeric
      THEN ROUND((1::numeric - ll.landed_per_piece_mvr / ROUND(s.fixed_selling_price_mvr, 0)) * 100::numeric, 1)
    ELSE NULL::numeric
  END AS actual_margin_pct,
  v.attributes, v.display_name AS variant_display,
  m.id AS model_id, m.name AS model_name,
  b.id AS brand_id, b.name AS brand_name,
  pc.id AS category_id, pc.name AS category_name,
  pc.unit_uom, pc.cost_basis,
  concat_ws(' › '::text, b.name, m.name, v.display_name, (s.pcs_per_pack || '×'::text) || s.packs_per_carton) AS full_path,
  s.sellable_units, pc.default_sellable_units
FROM skus s
  JOIN variants v ON v.id = s.variant_id
  JOIN product_models m ON m.id = v.model_id
  JOIN brands b ON b.id = m.brand_id
  JOIN product_categories pc ON pc.id = m.category_id
  LEFT JOIN latest_landed ll ON ll.sku_id = s.id;

GRANT SELECT ON v_skus TO authenticated;
REVOKE SELECT ON v_skus FROM anon;

-- ══════════════════════════════════════════════════════════════════════════════
-- (1) record_stock_transfer — FIFO move between godowns (same batch, two movements)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION record_stock_transfer(
  p_sku_id     UUID,
  p_from_godown UUID,
  p_to_godown   UUID,
  p_qty_pieces  INTEGER,
  p_notes       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_transfer  UUID := gen_random_uuid();  -- correlates the out/in pair in source_id
  v_remaining INTEGER := p_qty_pieces;
  v_take      INTEGER;
  v_batch     RECORD;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only an admin or manager can transfer stock';
  END IF;
  IF p_qty_pieces IS NULL OR p_qty_pieces <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be positive';
  END IF;
  IF p_from_godown = p_to_godown THEN
    RAISE EXCEPTION 'Source and destination warehouse must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM godowns WHERE id = p_from_godown)
     OR NOT EXISTS (SELECT 1 FROM godowns WHERE id = p_to_godown) THEN
    RAISE EXCEPTION 'Invalid warehouse';
  END IF;

  -- FIFO-drain the source godown's on-hand for this SKU, oldest batch first. Each
  -- slice is a (transfer_out @A, transfer_in @B) pair on the SAME batch — no batch
  -- cloning; the movement's godown_id is what relocates the pieces (see view above).
  FOR v_batch IN
    SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at
    FROM v_batch_stock bs
    WHERE bs.sku_id = p_sku_id
      AND bs.godown_id = p_from_godown
      AND bs.qty_pieces_remaining > 0
    ORDER BY bs.received_at ASC, bs.batch_id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);

    INSERT INTO stock_movements
      (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
    VALUES
      (v_batch.batch_id, p_sku_id, p_from_godown, 'transfer_out', v_take, 'transfer', v_transfer, p_notes, v_user),
      (v_batch.batch_id, p_sku_id, p_to_godown,   'transfer_in',  v_take, 'transfer', v_transfer, p_notes, v_user);

    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Not enough stock in source warehouse (short by % pieces)', v_remaining;
  END IF;

  -- audit_log.action is constrained to insert/update/delete; use 'insert' (a new
  -- pair of movements was created) with the detail in reason, matching confirm_grn.
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('stock_movements', v_transfer, 'insert',
          format('Stock transfer: %s pcs of SKU %s from godown %s to %s',
                 p_qty_pieces, p_sku_id, p_from_godown, p_to_godown), v_user);

  RETURN v_transfer;
END $$;

REVOKE ALL ON FUNCTION record_stock_transfer(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_stock_transfer(UUID, UUID, UUID, INTEGER, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- (2) Physical verification: session + lines + record_verification RPC
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS stock_verification_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  godown_id     UUID NOT NULL REFERENCES godowns(id),
  verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by   UUID REFERENCES auth.users(id),
  notes         TEXT,
  lines_total       INTEGER NOT NULL DEFAULT 0,  -- how many SKU lines were submitted
  lines_discrepant  INTEGER NOT NULL DEFAULT 0,  -- how many needed an adjustment
  net_delta_pieces  INTEGER NOT NULL DEFAULT 0,  -- sum of signed deltas (found − lost)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_verification_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES stock_verification_sessions(id) ON DELETE CASCADE,
  sku_id         UUID NOT NULL REFERENCES skus(id),
  expected_pieces INTEGER NOT NULL,   -- system on-hand at count time
  counted_pieces  INTEGER NOT NULL,   -- what was physically counted
  delta_pieces    INTEGER NOT NULL,   -- counted − expected (signed)
  reason          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verif_lines_session ON stock_verification_lines(session_id);
CREATE INDEX IF NOT EXISTS idx_verif_sessions_godown ON stock_verification_sessions(godown_id, verified_at DESC);

ALTER TABLE stock_verification_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_verification_lines    ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user (matches inventory read visibility); all
-- writes go exclusively through the SECURITY DEFINER RPC below, so no write policy.
DROP POLICY IF EXISTS verif_sessions_read ON stock_verification_sessions;
CREATE POLICY verif_sessions_read ON stock_verification_sessions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS verif_lines_read ON stock_verification_lines;
CREATE POLICY verif_lines_read ON stock_verification_lines
  FOR SELECT TO authenticated USING (true);

-- record_verification: takes the whole submitted count sheet as JSONB
--   [{ "sku_id": "...", "counted_pieces": 88, "reason": "miscount" }, ...]
-- Only lines the verifier actually touched are submitted. For each: compare to
-- live system on-hand (expected), record the line, and if they differ post the
-- exact 'adjustment' movements to snap on-hand to the physical count.
CREATE OR REPLACE FUNCTION record_verification(
  p_godown_id UUID,
  p_counts    JSONB,        -- array of { sku_id, counted_pieces, reason? }
  p_notes     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_session   UUID;
  v_item      JSONB;
  v_sku       UUID;
  v_counted   INTEGER;
  v_reason    TEXT;
  v_expected  INTEGER;
  v_delta     INTEGER;
  v_remaining INTEGER;
  v_take      INTEGER;
  v_batch     RECORD;
  v_target_batch UUID;
  v_total     INTEGER := 0;
  v_discrep   INTEGER := 0;
  v_net       INTEGER := 0;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only an admin or manager can record a stock verification';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM godowns WHERE id = p_godown_id) THEN
    RAISE EXCEPTION 'Invalid warehouse';
  END IF;
  IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' THEN
    RAISE EXCEPTION 'Counts must be a JSON array';
  END IF;

  INSERT INTO stock_verification_sessions (godown_id, verified_by, notes)
  VALUES (p_godown_id, v_user, p_notes)
  RETURNING id INTO v_session;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_counts)
  LOOP
    v_sku     := (v_item->>'sku_id')::UUID;
    v_counted := (v_item->>'counted_pieces')::INTEGER;
    v_reason  := NULLIF(v_item->>'reason', '');

    IF v_sku IS NULL OR v_counted IS NULL THEN
      RAISE EXCEPTION 'Each count needs sku_id and counted_pieces';
    END IF;
    IF v_counted < 0 THEN
      RAISE EXCEPTION 'Counted quantity cannot be negative';
    END IF;

    -- Live system on-hand for this SKU in this godown = the "expected" figure.
    SELECT COALESCE(qty_pieces, 0) INTO v_expected
    FROM v_stock_levels
    WHERE sku_id = v_sku AND godown_id = p_godown_id;
    v_expected := COALESCE(v_expected, 0);

    v_delta := v_counted - v_expected;
    v_total := v_total + 1;

    INSERT INTO stock_verification_lines
      (session_id, sku_id, expected_pieces, counted_pieces, delta_pieces, reason)
    VALUES (v_session, v_sku, v_expected, v_counted, v_delta, v_reason);

    -- Matching line → nothing to post.
    CONTINUE WHEN v_delta = 0;

    v_discrep := v_discrep + 1;
    v_net     := v_net + v_delta;

    IF v_delta < 0 THEN
      -- SHRINKAGE: remove the missing pieces FIFO (oldest batch first), each as a
      -- negative 'adjustment' on that batch so batch-level value stays correct.
      v_remaining := -v_delta;
      FOR v_batch IN
        SELECT bs.batch_id, bs.qty_pieces_remaining
        FROM v_batch_stock bs
        WHERE bs.sku_id = v_sku
          AND bs.godown_id = p_godown_id
          AND bs.qty_pieces_remaining > 0
        ORDER BY bs.received_at ASC, bs.batch_id ASC
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
        INSERT INTO stock_movements
          (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
        VALUES
          (v_batch.batch_id, v_sku, p_godown_id, 'adjustment', -v_take, 'adjustment', v_session,
           COALESCE(v_reason, 'Physical verification shortfall'), v_user);
        v_remaining := v_remaining - v_take;
      END LOOP;
      -- If v_remaining > 0 the system thought there was less than we're removing;
      -- shouldn't happen because delta was computed from the same on-hand, but
      -- guard anyway so we never silently under-adjust.
      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'Verification could not reconcile shortfall for SKU % (stock shifted mid-count) — retry', v_sku;
      END IF;
    ELSE
      -- SURPLUS: found more than the system knew. We can't invent a landed cost,
      -- so attach the extra to the newest existing batch in this godown (its cost
      -- is the best available estimate). If the SKU has NO batch here yet, fall
      -- back to the newest batch anywhere for this SKU.
      SELECT b.id INTO v_target_batch
      FROM inventory_batches b
      WHERE b.sku_id = v_sku AND b.godown_id = p_godown_id
      ORDER BY b.received_at DESC, b.id DESC
      LIMIT 1;

      IF v_target_batch IS NULL THEN
        SELECT b.id INTO v_target_batch
        FROM inventory_batches b
        WHERE b.sku_id = v_sku
        ORDER BY b.received_at DESC, b.id DESC
        LIMIT 1;
      END IF;

      IF v_target_batch IS NULL THEN
        RAISE EXCEPTION 'Cannot add surplus for a SKU that has never been received (no cost basis exists)';
      END IF;

      INSERT INTO stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
      VALUES
        (v_target_batch, v_sku, p_godown_id, 'adjustment', v_delta, 'adjustment', v_session,
         COALESCE(v_reason, 'Physical verification surplus'), v_user);
    END IF;
  END LOOP;

  UPDATE stock_verification_sessions
  SET lines_total = v_total, lines_discrepant = v_discrep, net_delta_pieces = v_net
  WHERE id = v_session;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('stock_verification_sessions', v_session, 'insert',
          format('Physical verification; %s lines, %s discrepant, net %s pcs', v_total, v_discrep, v_net), v_user);

  RETURN v_session;
END $$;

REVOKE ALL ON FUNCTION record_verification(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_verification(UUID, JSONB, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- (3) v_verification_history — read side for the audit list
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_verification_history
WITH (security_invoker = true) AS
SELECT
  s.id            AS session_id,
  s.godown_id,
  g.name          AS godown_name,
  s.verified_at,
  s.verified_by,
  s.notes,
  s.lines_total,
  s.lines_discrepant,
  s.net_delta_pieces
FROM stock_verification_sessions s
JOIN godowns g ON g.id = s.godown_id
ORDER BY s.verified_at DESC;

GRANT SELECT ON v_verification_history TO authenticated;

COMMIT;

-- 0158 — the reprice button works when the shelf is empty.
--
-- Fourth pass of the audit. The three earlier passes swept functions that
-- write stock_movements, order_payments or inventory_batches — and that scope
-- had a hole: PRICE writes were never in the list. A wrong price is money
-- just as surely as a wrong payment.
--
-- Re-run against price-writing functions, the whole pricing surface came back
-- untested: apply_target_prices, round_selling_prices_skus, get_price_book,
-- get_tier_price_for_sku, get_tier_prices_for_skus, get_pricing_health. Not
-- one had a test. apply_target_prices is the one that WRITES what customers
-- are charged, so it went first.
--
-- THE BUG — third instance of a class fixed twice before
--
-- The reprice looks up landed cost from IN-STOCK batches only:
--
--     SELECT bs.landed_per_piece_mvr ... WHERE bs.qty_pieces_remaining > 0
--     ORDER BY bs.received_at DESC LIMIT 1;
--     IF v_landed IS NULL THEN
--       RAISE EXCEPTION 'No landed cost yet — receive stock via a GRN first';
--
-- So the moment a product sells out, Margin Watch's one-tap reprice refuses,
-- claiming there is no landed cost — when the app knows exactly what it cost.
--
-- Measured on production. Exactly one SKU carries a target margin, and it is
-- MAMYPOKO XTRA KERING NB/S — the same product Ali said he had priced and
-- then found empty (migration 0149). It is currently out of stock:
--
--   on hand                      0 pieces
--   cost the reprice can find    NULL      -> refuses
--   cost the app already knows   MVR 2.1287/piece
--
-- Tap reprice on the product he is about to reorder and he is told to receive
-- stock first. The one SKU the feature exists for is the one it fails on.
--
-- This is the THIRD time this class has been fixed:
--   0092  get_price_book  — after Ali sent a screenshot of NB/S reading
--                           "No landed cost yet"
--   0149  v_skus          — the same product losing its derived price and
--                           its margin the moment it sold out
--   0158  apply_target_prices — never given the treatment, and it is the one
--                           that actually writes the price
--
-- The fix is 0149's proven pattern: prefer an IN-STOCK batch (so live pricing
-- is untouched), and fall back to the most recent batch of any kind. A SKU
-- that has genuinely never been received still has no batch, so it still
-- correctly refuses — with the message it always had.
--
-- SECOND FIX — a rounded price can never land at or below cost
--
-- Rule 7: losing money is a decision, never an accident. The new price is
-- ROUND(landed / (1 - margin), 0), and rounding is to NEAREST. For a small
-- target margin the rounded result can land on cost exactly, or below it:
--
--   landed MVR 10.00, target 1%  ->  10.101  ->  rounds to 10  ->  0% margin
--
-- The function would then report it had repriced to a 1% target while writing
-- a price that earns nothing. It now rounds UP whenever rounding to nearest
-- would not clear cost. Normal margins are unaffected — 44.9% on MVR 2.1287
-- gives 3.86, which rounds to 4 either way — so this changes no price Ali
-- actually has, it closes a hole.
--
-- Untouched deliberately: which batch's cost is used when several are in
-- stock. Newest-first matches v_skus.latest_landed and get_promo_suggestions,
-- so "current landed cost" means the same thing everywhere. Changing it here
-- alone would make the reprice disagree with the margin shown beside it.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_target_prices(p_sku_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sku        skus%ROWTYPE;
  v_landed     numeric;
  v_from_stock boolean := true;
  v_new_piece  numeric;
  v_new_pack   numeric;
  v_new_carton numeric;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can reprice';
  END IF;

  SELECT * INTO v_sku FROM skus WHERE id = p_sku_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SKU not found'; END IF;
  IF v_sku.target_margin_pct IS NULL OR v_sku.target_margin_pct <= 0
     OR v_sku.target_margin_pct >= 100 THEN
    RAISE EXCEPTION 'SKU has no valid target margin — set one first';
  END IF;

  -- Prefer stock on the shelf; fall back to the last batch received. Same
  -- pattern as get_price_book (0092) and v_skus (0149) — a product that has
  -- sold out has not forgotten what it cost.
  SELECT bs.landed_per_piece_mvr INTO v_landed
  FROM v_batch_stock bs
  WHERE bs.sku_id = p_sku_id AND bs.qty_pieces_remaining > 0
  ORDER BY bs.received_at DESC
  LIMIT 1;

  IF v_landed IS NULL THEN
    SELECT ib.landed_per_piece_mvr INTO v_landed
    FROM inventory_batches ib
    WHERE ib.sku_id = p_sku_id AND ib.landed_per_piece_mvr IS NOT NULL
    ORDER BY ib.received_at DESC
    LIMIT 1;
    v_from_stock := false;
  END IF;

  IF v_landed IS NULL THEN
    RAISE EXCEPTION 'No landed cost yet — receive stock via a GRN first';
  END IF;

  -- Round to whole rufiyaa, but never onto or under cost. Rounding to nearest
  -- can swallow a thin target margin whole (rule 7).
  v_new_piece  := ROUND(v_landed / (1 - v_sku.target_margin_pct / 100.0), 0);
  IF v_new_piece <= v_landed THEN
    v_new_piece := CEIL(v_landed / (1 - v_sku.target_margin_pct / 100.0));
  END IF;

  v_new_pack := ROUND(v_landed * v_sku.pcs_per_pack
                      / (1 - v_sku.target_margin_pct / 100.0), 0);
  IF v_new_pack <= v_landed * v_sku.pcs_per_pack THEN
    v_new_pack := CEIL(v_landed * v_sku.pcs_per_pack
                       / (1 - v_sku.target_margin_pct / 100.0));
  END IF;

  v_new_carton := ROUND(v_landed * v_sku.pcs_per_pack * v_sku.packs_per_carton
                        / (1 - v_sku.target_margin_pct / 100.0), 0);
  IF v_new_carton <= v_landed * v_sku.pcs_per_pack * v_sku.packs_per_carton THEN
    v_new_carton := CEIL(v_landed * v_sku.pcs_per_pack * v_sku.packs_per_carton
                         / (1 - v_sku.target_margin_pct / 100.0));
  END IF;

  -- Only prices that are already set get rewritten: a SKU with no carton
  -- price does not acquire one by being repriced.
  UPDATE skus SET
    fixed_selling_price_mvr    = CASE WHEN fixed_selling_price_mvr    IS NOT NULL THEN v_new_piece  ELSE NULL END,
    fixed_price_per_pack_mvr   = CASE WHEN fixed_price_per_pack_mvr   IS NOT NULL THEN v_new_pack   ELSE NULL END,
    fixed_price_per_carton_mvr = CASE WHEN fixed_price_per_carton_mvr IS NOT NULL THEN v_new_carton ELSE NULL END,
    updated_at = now()
  WHERE id = p_sku_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('skus', p_sku_id, 'update',
          format('Repriced to %s%% target margin from landed %s MVR/pc%s (piece %s → %s, pack %s → %s, carton %s → %s)',
                 v_sku.target_margin_pct, v_landed,
                 -- Say so when the basis is a sold-out batch, so the audit
                 -- trail shows what the number was actually built on.
                 CASE WHEN v_from_stock THEN '' ELSE ' (last known — nothing in stock)' END,
                 v_sku.fixed_selling_price_mvr,    CASE WHEN v_sku.fixed_selling_price_mvr    IS NOT NULL THEN v_new_piece  END,
                 v_sku.fixed_price_per_pack_mvr,   CASE WHEN v_sku.fixed_price_per_pack_mvr   IS NOT NULL THEN v_new_pack   END,
                 v_sku.fixed_price_per_carton_mvr, CASE WHEN v_sku.fixed_price_per_carton_mvr IS NOT NULL THEN v_new_carton END),
          auth.uid());
END $function$;

REVOKE EXECUTE ON FUNCTION public.apply_target_prices(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_target_prices(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_target_prices(uuid) TO authenticated;

COMMIT;

-- Ali's rule: every customer-facing selling price is a whole MVR number.
-- Migration 0043 rounded computed/read-time prices (v_skus, tier-price RPCs).
-- This migration closes the gap for manually-typed prices: staff can still
-- type "165.50" into a form, but Postgres rounds it to a whole number at
-- write time, so the stored value -- and every future read of it, regardless
-- of which screen or query reads it -- is guaranteed whole. Consistent with
-- the project rule that financial values are enforced in Postgres, not left
-- to each frontend call site to remember to round.

CREATE OR REPLACE FUNCTION round_selling_prices_price_list_items()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price_per_piece_mvr  IS NOT NULL THEN NEW.price_per_piece_mvr  := ROUND(NEW.price_per_piece_mvr, 0); END IF;
  IF NEW.price_per_pack_mvr   IS NOT NULL THEN NEW.price_per_pack_mvr   := ROUND(NEW.price_per_pack_mvr, 0); END IF;
  IF NEW.price_per_carton_mvr IS NOT NULL THEN NEW.price_per_carton_mvr := ROUND(NEW.price_per_carton_mvr, 0); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_round_selling_prices ON price_list_items;
CREATE TRIGGER trg_round_selling_prices
  BEFORE INSERT OR UPDATE OF price_per_piece_mvr, price_per_pack_mvr, price_per_carton_mvr ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION round_selling_prices_price_list_items();

CREATE OR REPLACE FUNCTION round_selling_prices_skus()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fixed_selling_price_mvr   IS NOT NULL THEN NEW.fixed_selling_price_mvr   := ROUND(NEW.fixed_selling_price_mvr, 0); END IF;
  IF NEW.fixed_price_per_pack_mvr  IS NOT NULL THEN NEW.fixed_price_per_pack_mvr  := ROUND(NEW.fixed_price_per_pack_mvr, 0); END IF;
  IF NEW.fixed_price_per_carton_mvr IS NOT NULL THEN NEW.fixed_price_per_carton_mvr := ROUND(NEW.fixed_price_per_carton_mvr, 0); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_round_selling_prices ON skus;
CREATE TRIGGER trg_round_selling_prices
  BEFORE INSERT OR UPDATE OF fixed_selling_price_mvr, fixed_price_per_pack_mvr, fixed_price_per_carton_mvr ON skus
  FOR EACH ROW EXECUTE FUNCTION round_selling_prices_skus();

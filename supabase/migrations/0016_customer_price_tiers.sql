-- ── Migration 0016: Customer price tiers ─────────────────────────────────
--
-- Adds a tiered pricing system:
--   1. price_tier column on customers (retail / wholesale / vip / promo)
--   2. price_lists table (versioned, named, tier-linked)
--   3. price_list_items table (sku → selling price per uom)
--   4. get_tier_price_for_sku(sku_id, tier) RPC — returns prices for all 3 uoms
--
-- Selling price formula (non-negotiable): landed_cost ÷ (1 − margin%)
-- Old prices on skus table remain as the "retail" default fallback.

-- ── 1. Add price_tier to customers ───────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS price_tier TEXT NOT NULL DEFAULT 'retail'
    CHECK (price_tier IN ('retail', 'wholesale', 'vip', 'promo'));

-- ── 2. price_lists table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('retail', 'wholesale', 'vip', 'promo')),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tier, effective_from)   -- one list per tier per day
);

-- ── 3. price_list_items table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_list_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id    UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  sku_id           UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  price_per_piece_mvr   NUMERIC(15,4) NOT NULL CHECK (price_per_piece_mvr >= 0),
  price_per_pack_mvr    NUMERIC(15,4) NOT NULL CHECK (price_per_pack_mvr >= 0),
  price_per_carton_mvr  NUMERIC(15,4) NOT NULL CHECK (price_per_carton_mvr >= 0),
  margin_pct            NUMERIC(6,2),    -- recorded at time of entry for audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, sku_id)
);

-- ── 4. Indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_price_lists_tier_date
  ON price_lists(tier, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_price_list_items_list_sku
  ON price_list_items(price_list_id, sku_id);

CREATE INDEX IF NOT EXISTS idx_customers_tier
  ON customers(price_tier);

-- ── 5. RPC: get most-recent active price for a sku+tier ───────────────────
-- Returns one row: piece / pack / carton prices.
-- Falls back to the sku's own selling_price columns if no price list entry exists.
CREATE OR REPLACE FUNCTION get_tier_price_for_sku(
  p_sku_id UUID,
  p_tier   TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  price_per_piece_mvr   NUMERIC,
  price_per_pack_mvr    NUMERIC,
  price_per_carton_mvr  NUMERIC,
  source                TEXT   -- 'price_list' | 'sku_default'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Most-recent price list for this tier on or before today
  WITH active_list AS (
    SELECT id
    FROM price_lists
    WHERE tier = p_tier
      AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC
    LIMIT 1
  ),
  list_price AS (
    SELECT
      pli.price_per_piece_mvr,
      pli.price_per_pack_mvr,
      pli.price_per_carton_mvr,
      'price_list'::TEXT AS source
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = p_sku_id
    LIMIT 1
  ),
  sku_default AS (
    SELECT
      s.selling_price_per_piece_mvr   AS price_per_piece_mvr,
      s.selling_price_per_pack_mvr    AS price_per_pack_mvr,
      s.selling_price_per_carton_mvr  AS price_per_carton_mvr,
      'sku_default'::TEXT             AS source
    FROM skus s
    WHERE s.id = p_sku_id
    LIMIT 1
  )
  SELECT * FROM list_price
  UNION ALL
  SELECT * FROM sku_default
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_tier_price_for_sku(UUID, TEXT) TO authenticated;

-- ── 6. RPC: bulk prices for all SKUs in an order given a tier ─────────────
-- Used by the sales UI to pre-fill prices when customer tier is known.
-- Returns sku_id + all three price columns + source.
CREATE OR REPLACE FUNCTION get_tier_prices_for_skus(
  p_sku_ids UUID[],
  p_tier    TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  sku_id               UUID,
  price_per_piece_mvr  NUMERIC,
  price_per_pack_mvr   NUMERIC,
  price_per_carton_mvr NUMERIC,
  source               TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_list AS (
    SELECT id
    FROM price_lists
    WHERE tier = p_tier
      AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC
    LIMIT 1
  ),
  list_prices AS (
    SELECT
      pli.sku_id,
      pli.price_per_piece_mvr,
      pli.price_per_pack_mvr,
      pli.price_per_carton_mvr,
      'price_list'::TEXT AS source
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = ANY(p_sku_ids)
  ),
  sku_defaults AS (
    SELECT
      s.id                            AS sku_id,
      s.selling_price_per_piece_mvr   AS price_per_piece_mvr,
      s.selling_price_per_pack_mvr    AS price_per_pack_mvr,
      s.selling_price_per_carton_mvr  AS price_per_carton_mvr,
      'sku_default'::TEXT             AS source
    FROM skus s
    WHERE s.id = ANY(p_sku_ids)
  )
  -- List price wins over SKU default (DISTINCT ON keeps first match)
  SELECT DISTINCT ON (all_prices.sku_id)
    all_prices.sku_id,
    all_prices.price_per_piece_mvr,
    all_prices.price_per_pack_mvr,
    all_prices.price_per_carton_mvr,
    all_prices.source
  FROM (
    SELECT * FROM list_prices
    UNION ALL
    SELECT * FROM sku_defaults
  ) all_prices
  ORDER BY all_prices.sku_id, (all_prices.source = 'price_list') DESC;
$$;

GRANT EXECUTE ON FUNCTION get_tier_prices_for_skus(UUID[], TEXT) TO authenticated;

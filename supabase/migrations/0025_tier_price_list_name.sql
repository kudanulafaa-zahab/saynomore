-- Migration 0025: add price_list_name + price_list_date to tier price RPCs
-- Sales UI needs to show WHICH price list is driving the price, not just "price_list".
-- No table changes — only function replacements.

DROP FUNCTION IF EXISTS get_tier_price_for_sku(UUID, TEXT);
DROP FUNCTION IF EXISTS get_tier_prices_for_skus(UUID[], TEXT);

-- ── Single-SKU RPC ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_tier_price_for_sku(
  p_sku_id UUID,
  p_tier   TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  price_per_piece_mvr   NUMERIC,
  price_per_pack_mvr    NUMERIC,
  price_per_carton_mvr  NUMERIC,
  source                TEXT,
  price_list_name       TEXT,
  price_list_date       DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_list AS (
    SELECT id, name, effective_from
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
      'price_list'::TEXT        AS source,
      al.name                   AS price_list_name,
      al.effective_from         AS price_list_date
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = p_sku_id
    LIMIT 1
  ),
  sku_default AS (
    SELECT
      s.fixed_selling_price_mvr                                     AS price_per_piece_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack, 2)         AS price_per_pack_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack
            * s.packs_per_carton, 2)                                AS price_per_carton_mvr,
      'sku_default'::TEXT                                           AS source,
      NULL::TEXT                                                    AS price_list_name,
      NULL::DATE                                                    AS price_list_date
    FROM skus s
    WHERE s.id = p_sku_id
      AND s.fixed_selling_price_mvr IS NOT NULL
    LIMIT 1
  )
  SELECT * FROM list_price
  UNION ALL
  SELECT * FROM sku_default
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_tier_price_for_sku(UUID, TEXT) TO authenticated;

-- ── Bulk RPC ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_tier_prices_for_skus(
  p_sku_ids UUID[],
  p_tier    TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  sku_id               UUID,
  price_per_piece_mvr  NUMERIC,
  price_per_pack_mvr   NUMERIC,
  price_per_carton_mvr NUMERIC,
  source               TEXT,
  price_list_name      TEXT,
  price_list_date      DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_list AS (
    SELECT id, name, effective_from
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
      'price_list'::TEXT  AS source,
      al.name             AS price_list_name,
      al.effective_from   AS price_list_date
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = ANY(p_sku_ids)
  ),
  sku_defaults AS (
    SELECT
      s.id                                                          AS sku_id,
      s.fixed_selling_price_mvr                                     AS price_per_piece_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack, 2)         AS price_per_pack_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack
            * s.packs_per_carton, 2)                                AS price_per_carton_mvr,
      'sku_default'::TEXT                                           AS source,
      NULL::TEXT                                                    AS price_list_name,
      NULL::DATE                                                    AS price_list_date
    FROM skus s
    WHERE s.id = ANY(p_sku_ids)
      AND s.fixed_selling_price_mvr IS NOT NULL
  )
  SELECT DISTINCT ON (all_prices.sku_id)
    all_prices.sku_id,
    all_prices.price_per_piece_mvr,
    all_prices.price_per_pack_mvr,
    all_prices.price_per_carton_mvr,
    all_prices.source,
    all_prices.price_list_name,
    all_prices.price_list_date
  FROM (
    SELECT * FROM list_prices
    UNION ALL
    SELECT * FROM sku_defaults
  ) all_prices
  ORDER BY all_prices.sku_id, (all_prices.source = 'price_list') DESC;
$$;

GRANT EXECUTE ON FUNCTION get_tier_prices_for_skus(UUID[], TEXT) TO authenticated;

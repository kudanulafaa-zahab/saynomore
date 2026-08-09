-- 0162 — Margin Watch judges the units you actually sell, and never stays
-- quiet about a below-cost price.
--
-- get_pricing_health drives Margin Watch. It had no tests, and an audit of it
-- found three defects. Measured on production, 2026-08-09.
--
-- ── 1. A PRODUCT SOLD BELOW COST READS AS 'ok' ────────────────────────────
--
-- The only "this price is wrong" verdict was 'below_target':
--
--     WHEN target_margin_pct IS NOT NULL AND target_margin_pct > 0
--          AND LEAST(...) < target_margin_pct - 1.0
--       THEN 'below_target'
--     ELSE 'ok'
--
-- No target margin, no verdict. And `target_margin_pct` is NULL on ALL 26
-- SKUs currently holding stock, so `below_target` cannot fire for any product
-- in the business. get_pricing_health returns zero rows today — Margin Watch
-- shows a clean bill of health while being structurally incapable of issuing
-- any other one.
--
-- The consequence is not just silence. A price BELOW landed cost also falls
-- through to 'ok', because the only branch that could have caught it needs a
-- target that isn't there. Losing money would be reported as healthy.
--
-- That breaks the standing rule: losing money is a decision, never an
-- accident. Below-cost is an ABSOLUTE judgement — it needs no target, only a
-- cost and a price — so it gets its own status, tested before 'below_target'
-- (a below-cost price is also below any positive target).
--
-- Nothing is below cost on production today; the worst real margin is 21.5%
-- on MAMY-SKIN-L-42x3 by the carton. This closes the hole before it is used,
-- rather than after.
--
-- ── 2. MARGINS MEASURED ON UNITS THAT ARE NEVER SOLD ──────────────────────
--
-- `worst` was LEAST(m_piece, m_pack, m_carton) with no reference to
-- sellable_units, so a price for a unit the product isn't sold in could drive
-- the verdict. This is the class migration 0139 fixed ("dividing landed cost
-- by a per-piece price nobody is charged produced margins wrong on 21 of 29
-- SKUs") and 0160 fixed again in the tier pricing engine. get_pricing_health
-- was never swept — rule 9: a fix for one instance of a bug class is not done
-- until the whole surface is swept systematically.
--
-- The exposure, measured: 29 of 31 active SKUs carry a
-- `fixed_selling_price_mvr` — a PIECE price — and not one SKU sells by the
-- piece. MAMY-XTRA-XXXL-34x3 is pack-only and carries a carton price of 790.
--
-- The phantom piece margins happen to sit close to the real pack margins
-- today (23.8% vs 23.7%, and so on) because the piece prices were derived
-- from the pack prices. That is luck, not correctness: nothing stops a piece
-- price being edited, and the moment one is, a product's health verdict comes
-- from a sale that cannot happen.
--
-- Piece is left in the OUTPUT (the column stays, NULL when not sellable) for
-- the same reason as 0160 — the Market screen compares rivals per-piece, and
-- removing columns breaks the read contract for no gain.
--
-- ── 3. 'no_price' MISSED PRODUCTS THAT HAVE NO SELLABLE PRICE ─────────────
--
-- 'no_price' required ALL THREE fixed prices to be NULL. A product with only
-- a piece price therefore counted as priced — even though a piece is never
-- sold, so there is no price for anything the customer can buy. Two real
-- products are in exactly this state and both currently read 'ok':
--
--   MAMY-SKIN-XXL-32x3   sells {pack,carton}   only a piece price (7.19)
--   MAMA-MAMA-1x12       sells {pack,carton}   only a piece price (23.00)
--
-- 'no_price' now means what it says: no price for any unit this product is
-- actually sold in.
--
-- ── DELIBERATELY NOT DONE ─────────────────────────────────────────────────
--
-- No 'no_target' status. Every stocked SKU lacks a target margin, so it would
-- put 26 of 31 products on the watch list — precisely the alert fatigue
-- migration 0150 removed ("an alert on 20 of 31 products is an alert nobody
-- reads"). That target margins are unset is a data gap for Ali to decide on,
-- not a per-product alarm to raise 26 times.

BEGIN;

DROP FUNCTION IF EXISTS public.get_pricing_health();

CREATE FUNCTION public.get_pricing_health()
RETURNS TABLE (
  sku_id uuid,
  internal_code text,
  full_path text,
  stock_pieces integer,
  stock_value_mvr numeric,
  landed_per_piece_mvr numeric,
  target_margin_pct numeric,
  margin_piece_pct numeric,
  margin_pack_pct numeric,
  margin_carton_pct numeric,
  worst_margin_pct numeric,
  suggested_piece_mvr numeric,
  suggested_pack_mvr numeric,
  suggested_carton_mvr numeric,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH latest_landed AS (
    SELECT DISTINCT ON (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    ORDER BY bs.sku_id, bs.received_at DESC
  ),
  stock AS (
    SELECT bs.sku_id,
           SUM(bs.qty_pieces_remaining)::integer AS pieces,
           SUM(bs.qty_pieces_remaining * COALESCE(bs.landed_per_piece_mvr, 0)) AS value_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    GROUP BY bs.sku_id
  ),
  base AS (
    SELECT
      s.id,
      s.internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) AS full_path,
      st.pieces,
      ROUND(st.value_mvr, 2) AS value_mvr,
      ll.landed_per_piece_mvr AS landed,
      s.target_margin_pct,
      s.pcs_per_pack,
      s.packs_per_carton,
      -- A price is only a price if the product is sold in that unit.
      -- sellable_units is the single source of truth (CLAUDE.md), and it is
      -- applied HERE so every figure downstream inherits it.
      CASE WHEN 'piece'  = ANY(s.sellable_units)
           THEN s.fixed_selling_price_mvr    END AS fix_piece,
      CASE WHEN 'pack'   = ANY(s.sellable_units)
           THEN s.fixed_price_per_pack_mvr   END AS fix_pack,
      CASE WHEN 'carton' = ANY(s.sellable_units)
           THEN s.fixed_price_per_carton_mvr END AS fix_carton,
      s.sellable_units
    FROM skus s
    JOIN stock st          ON st.sku_id = s.id
    LEFT JOIN latest_landed ll ON ll.sku_id = s.id
    JOIN variants v        ON v.id = s.variant_id
    JOIN product_models m  ON m.id = v.model_id
    JOIN brands b          ON b.id = m.brand_id
    WHERE s.is_active
  ),
  margins AS (
    SELECT *,
      CASE WHEN fix_piece  > 0 AND landed IS NOT NULL
           THEN ROUND((1 - landed / fix_piece) * 100, 1) END AS m_piece,
      CASE WHEN fix_pack   > 0 AND landed IS NOT NULL
           THEN ROUND((1 - landed * pcs_per_pack / fix_pack) * 100, 1) END AS m_pack,
      CASE WHEN fix_carton > 0 AND landed IS NOT NULL
           THEN ROUND((1 - landed * pcs_per_pack * packs_per_carton / fix_carton) * 100, 1) END AS m_carton
    FROM base
  ),
  judged AS (
    SELECT *,
      LEAST(
        COALESCE(m_piece,  999),
        COALESCE(m_pack,   999),
        COALESCE(m_carton, 999)
      ) AS worst,
      CASE
        WHEN landed IS NULL THEN 'no_cost'
        -- No price for ANY unit this product is sold in. A piece price on a
        -- pack/carton product is not a price the customer can ever pay.
        WHEN fix_piece IS NULL AND fix_pack IS NULL AND fix_carton IS NULL
             AND (target_margin_pct IS NULL OR target_margin_pct <= 0)
          THEN 'no_price'
        -- Absolute, and needs no target: at or under landed cost, every sale
        -- loses money. Tested BEFORE below_target, which a below-cost price
        -- also satisfies but which describes a milder problem.
        WHEN LEAST(COALESCE(m_piece, 999), COALESCE(m_pack, 999), COALESCE(m_carton, 999))
             <= 0
          THEN 'below_cost'
        WHEN target_margin_pct IS NOT NULL AND target_margin_pct > 0
             AND LEAST(COALESCE(m_piece, 999), COALESCE(m_pack, 999), COALESCE(m_carton, 999))
                 < target_margin_pct - 1.0
          THEN 'below_target'
        ELSE 'ok'
      END AS status
    FROM margins
  )
  SELECT
    id, internal_code, full_path,
    pieces, value_mvr, landed, target_margin_pct,
    m_piece, m_pack, m_carton,
    NULLIF(worst, 999),
    -- Suggested prices follow the same rule: never suggest a price for a unit
    -- the product is not sold in.
    CASE WHEN 'piece' = ANY(sellable_units) AND landed IS NOT NULL
              AND target_margin_pct > 0 AND target_margin_pct < 100
         THEN ROUND(landed / (1 - target_margin_pct / 100.0), 0) END,
    CASE WHEN 'pack' = ANY(sellable_units) AND landed IS NOT NULL
              AND target_margin_pct > 0 AND target_margin_pct < 100
         THEN ROUND(landed * pcs_per_pack / (1 - target_margin_pct / 100.0), 0) END,
    CASE WHEN 'carton' = ANY(sellable_units) AND landed IS NOT NULL
              AND target_margin_pct > 0 AND target_margin_pct < 100
         THEN ROUND(landed * pcs_per_pack * packs_per_carton / (1 - target_margin_pct / 100.0), 0) END,
    status
  FROM judged
  WHERE status <> 'ok'
  ORDER BY
    CASE status
      WHEN 'below_cost'   THEN 0
      WHEN 'below_target' THEN 1
      WHEN 'no_price'     THEN 2
      ELSE 3
    END,
    value_mvr DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pricing_health() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pricing_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pricing_health() TO authenticated;

COMMIT;

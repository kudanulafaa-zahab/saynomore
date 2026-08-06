-- 0149 — v_skus keeps a landed cost after a product sells out.
--
-- Ali, 2026-08-06: "I did set the price for NB/S but I can't remember how it
-- got lost." He was right that he set something, and nothing was lost: he set
-- a TARGET MARGIN of 44.90%, and the app derives the price from it as
--   landed cost x pcs_per_pack / (1 - margin).
-- v_skus.latest_landed only ever read batches WHERE qty_pieces_remaining > 0,
-- so the moment Xtra Kering NB/S sold out there was no landed cost, and the
-- derived price silently evaluated to NULL. The price disappeared at exactly
-- the moment he needed it to reorder and re-list.
--
-- The blast radius is wider than the one price. Landed cost also feeds
-- actual_margin_pct, so ALL FOUR currently out-of-stock SKUs had lost their
-- margin too — three of them (Xtra Kering L, Xtra Kering XL, Sosoft Green)
-- carry a perfectly good FIXED price and still showed no margin at all,
-- blinding Margin Watch and Reports on them for no reason other than an empty
-- shelf.
--
-- This is the SECOND instance of this exact bug class, on the SAME product.
-- Migration 0092 fixed it for get_price_book ("Price Book: fall back to
-- last-known landed cost when out of stock") after Ali sent a screenshot of
-- NB/S showing "No landed cost yet" — but only inside that one function.
-- v_skus, which everything else reads, was never given the same treatment.
-- Fixing the source this time rather than a second symptom.
--
-- The fix, mirroring 0092's proven pattern: prefer the cost of an IN-STOCK
-- batch (unchanged behaviour, so live costing is untouched), and fall back to
-- the most recent batch of any kind when nothing is in stock. A SKU that has
-- genuinely never been received still has no batch, so it still correctly has
-- no cost.
--
-- Proven against production before applying:
--   31 active SKUs — 4 GAIN a cost, 0 have a cost CHANGED, 0 left without one.
-- Purely additive; no existing figure moves.
--
-- security_invoker = true is restated deliberately: CREATE OR REPLACE VIEW
-- does NOT preserve reloptions, and dropping it here would hand every user
-- the view owner's rights. That regression happened once already and was
-- caught by the advisor (migration 0125).

BEGIN;

CREATE OR REPLACE VIEW public.v_skus WITH (security_invoker = true) AS
WITH latest_landed AS (
         SELECT DISTINCT ON (x.sku_id) x.sku_id, x.landed_per_piece_mvr
           FROM ( SELECT bs.sku_id, bs.landed_per_piece_mvr, bs.received_at, 0 AS src
                    FROM v_batch_stock bs
                   WHERE bs.qty_pieces_remaining > 0
                  UNION ALL
                  SELECT ib.sku_id, ib.landed_per_piece_mvr, ib.received_at, 1 AS src
                    FROM inventory_batches ib
                   WHERE ib.landed_per_piece_mvr IS NOT NULL ) x
          ORDER BY x.sku_id, x.src, x.received_at DESC
        )
 SELECT s.id,
    s.variant_id,
    s.internal_code,
    s.supplier_barcode,
    s.pcs_per_pack,
    s.packs_per_carton,
    s.pcs_per_pack * s.packs_per_carton AS pcs_per_carton,
    s.carton_length_cm,
    s.carton_width_cm,
    s.carton_height_cm,
    s.carton_weight_kg,
    s.cbm_per_carton,
    s.is_active,
    s.notes,
    s.created_at,
    s.updated_at,
    s.target_margin_pct,
    s.fixed_selling_price_mvr,
    s.fixed_price_per_pack_mvr,
    s.fixed_price_per_carton_mvr,
    ll.landed_per_piece_mvr,
        CASE
            WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr, 0)
            WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr / (1::numeric - s.target_margin_pct / 100.0), 0)
            ELSE NULL::numeric
        END AS selling_price_per_piece_mvr,
        CASE
            WHEN s.fixed_price_per_pack_mvr IS NOT NULL THEN round(s.fixed_price_per_pack_mvr, 0)
            WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)
            WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
            ELSE NULL::numeric
        END AS selling_price_per_pack_mvr,
        CASE
            WHEN s.fixed_price_per_carton_mvr IS NOT NULL THEN round(s.fixed_price_per_carton_mvr, 0)
            WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)
            WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
            ELSE NULL::numeric
        END AS selling_price_per_carton_mvr,
        CASE
            WHEN ll.landed_per_piece_mvr IS NULL OR ll.landed_per_piece_mvr <= 0::numeric THEN NULL::numeric
            ELSE ( SELECT round((1::numeric - ll.landed_per_piece_mvr / q.realised) * 100::numeric, 1) AS round
               FROM ( SELECT
                            CASE
                                WHEN ('pack'::text = ANY (s.sellable_units)) AND s.pcs_per_pack > 0 THEN COALESCE(round(s.fixed_price_per_pack_mvr, 0), round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)) / s.pcs_per_pack::numeric
                                WHEN ('carton'::text = ANY (s.sellable_units)) AND s.pcs_per_pack > 0 AND s.packs_per_carton > 0 THEN COALESCE(round(s.fixed_price_per_carton_mvr, 0), round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)) / (s.pcs_per_pack * s.packs_per_carton)::numeric
                                ELSE round(s.fixed_selling_price_mvr, 0)
                            END AS realised) q
              WHERE q.realised IS NOT NULL AND q.realised > 0::numeric)
        END AS actual_margin_pct,
    v.attributes,
    v.display_name AS variant_display,
    m.id AS model_id,
    m.name AS model_name,
    b.id AS brand_id,
    b.name AS brand_name,
    pc.id AS category_id,
    pc.name AS category_name,
    pc.unit_uom,
    pc.cost_basis,
    concat_ws(' > '::text, b.name, m.name, v.display_name, (s.pcs_per_pack || 'x'::text) || s.packs_per_carton) AS full_path,
    s.sellable_units,
    pc.default_sellable_units,
    pc.duty_rate_pct,
    b.mixed_carton_pieces,
    pc.sort_order AS category_sort_order
   FROM skus s
     JOIN variants v ON v.id = s.variant_id
     JOIN product_models m ON m.id = v.model_id
     JOIN brands b ON b.id = m.brand_id
     JOIN product_categories pc ON pc.id = m.category_id
     LEFT JOIN latest_landed ll ON ll.sku_id = s.id;

COMMIT;

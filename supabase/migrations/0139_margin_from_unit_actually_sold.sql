-- 0139 — Margin must be measured against the price actually charged.
--
-- Found while acting on Ali's instruction to stop doing only what he asks and
-- start finding what he doesn't know to ask about. Nobody had questioned this
-- figure; it has been wrong since the view was written.
--
-- v_skus.actual_margin_pct divided landed cost by fixed_selling_price_mvr —
-- the per-PIECE price. But NO SKU sells by the piece: all 29 priced SKUs have
-- sellable_units of {pack,carton}, {carton} or {pack}. The per-piece price is
-- an internal reference that is never quoted to a customer, while the pack and
-- carton prices Ali actually charges are stored separately and were ignored.
--
-- Result: the margin figure was wrong on 21 of 29 priced SKUs, in BOTH
-- directions. The overstated ones are the dangerous half —
--     Xtra Kering S     reported 47.3%, real 40.7%   (728 pcs sold)
--     Royal Soft Boy M  reported 31.8%, real 28.3%   (384 pcs sold)
--     Merries Good L    reported 39.1%, real 35.7%   (462 pcs sold)
-- Believing a thin product is fat is how a distributor prices a promotion
-- into a loss.
--
-- This figure feeds Margin Watch, Reports' average margin, the Price Book, the
-- Promo Advisor's clearance floor and the Cost Simulator. All of them
-- inherited the error.
--
-- Fix: measure against the unit the SKU is actually sold in — pack if it
-- sells packs (the common case), else carton, falling back to the per-piece
-- price only when neither is configured. This deliberately reuses the SAME
-- coalesce ladder the selling_price_per_* columns already use, so the margin
-- and the price on screen can no longer disagree with each other.
--
-- NOT changed: sales_order_lines.actual_margin_pct. Those were always right —
-- post_sale snapshots them from the real transacted unit price. Only this
-- catalogue-level "what should this earn" figure was wrong.
--
-- security_invoker=true is restated deliberately. CREATE OR REPLACE VIEW does
-- NOT preserve it, and losing it silently would re-open the hole migration
-- 0125 already had to close once. Verified present after applying.

create or replace view public.v_skus
with (security_invoker = true)
as
 WITH latest_landed AS (
         SELECT DISTINCT ON (v_batch_stock.sku_id) v_batch_stock.sku_id,
            v_batch_stock.landed_per_piece_mvr
           FROM v_batch_stock
          WHERE v_batch_stock.qty_pieces_remaining > 0
          ORDER BY v_batch_stock.sku_id, v_batch_stock.received_at DESC
        )
 SELECT s.id, s.variant_id, s.internal_code, s.supplier_barcode,
    s.pcs_per_pack, s.packs_per_carton,
    s.pcs_per_pack * s.packs_per_carton AS pcs_per_carton,
    s.carton_length_cm, s.carton_width_cm, s.carton_height_cm,
    s.carton_weight_kg, s.cbm_per_carton, s.is_active, s.notes,
    s.created_at, s.updated_at, s.target_margin_pct,
    s.fixed_selling_price_mvr, s.fixed_price_per_pack_mvr,
    s.fixed_price_per_carton_mvr, ll.landed_per_piece_mvr,
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
        -- Margin against the unit actually sold, never the per-piece reference.
        CASE
            WHEN ll.landed_per_piece_mvr IS NULL OR ll.landed_per_piece_mvr <= 0::numeric THEN NULL::numeric
            ELSE ( SELECT round((1::numeric - ll.landed_per_piece_mvr / q.realised) * 100::numeric, 1)
               FROM ( SELECT
                            CASE
                                WHEN ('pack'::text = ANY (s.sellable_units)) AND s.pcs_per_pack > 0
                                  THEN COALESCE(round(s.fixed_price_per_pack_mvr, 0), round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)) / s.pcs_per_pack::numeric
                                WHEN ('carton'::text = ANY (s.sellable_units)) AND s.pcs_per_pack > 0 AND s.packs_per_carton > 0
                                  THEN COALESCE(round(s.fixed_price_per_carton_mvr, 0), round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)) / (s.pcs_per_pack * s.packs_per_carton)::numeric
                                ELSE round(s.fixed_selling_price_mvr, 0)
                            END AS realised) q
              WHERE q.realised IS NOT NULL AND q.realised > 0::numeric)
        END AS actual_margin_pct,
    v.attributes, v.display_name AS variant_display,
    m.id AS model_id, m.name AS model_name,
    b.id AS brand_id, b.name AS brand_name,
    pc.id AS category_id, pc.name AS category_name,
    pc.unit_uom, pc.cost_basis,
    concat_ws(' > '::text, b.name, m.name, v.display_name, (s.pcs_per_pack || 'x'::text) || s.packs_per_carton) AS full_path,
    s.sellable_units, pc.default_sellable_units, pc.duty_rate_pct,
    b.mixed_carton_pieces, pc.sort_order AS category_sort_order
   FROM skus s
     JOIN variants v ON v.id = s.variant_id
     JOIN product_models m ON m.id = v.model_id
     JOIN brands b ON b.id = m.brand_id
     JOIN product_categories pc ON pc.id = m.category_id
     LEFT JOIN latest_landed ll ON ll.sku_id = s.id;
